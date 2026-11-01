const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { HttpsError, onCall } = require('firebase-functions/v2/https');

initializeApp();

const auth = getAuth();
const db = getFirestore();
const ACCOUNT_ROLES = new Set(['phonha', 'thuquy', 'sinh_vien', 'truongnha']);

async function requireHouseManager(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Vui lòng đăng nhập lại.');
  }

  const managerSnapshot = await db.collection('users').doc(request.auth.uid).get();
  if (!managerSnapshot.exists || managerSnapshot.data().role !== 'truongnha') {
    throw new HttpsError('permission-denied', 'Chỉ trưởng nhà mới được quản lý tài khoản.');
  }

  return managerSnapshot.data();
}

function validateMemberData(data) {
  const email = String(data.email || '').trim().toLowerCase();
  const fullName = String(data.full_name || '').trim();
  const holyName = String(data.holy_name || '').trim();
  const role = String(data.role || '');
  const houseId = String(data.house_id || '');

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'Email không hợp lệ.');
  }
  if (!fullName || fullName.length > 120) {
    throw new HttpsError('invalid-argument', 'Họ tên không hợp lệ.');
  }
  if (holyName.length > 80) {
    throw new HttpsError('invalid-argument', 'Tên thánh không hợp lệ.');
  }
  if (!ACCOUNT_ROLES.has(role)) {
    throw new HttpsError('invalid-argument', 'Chức vụ không hợp lệ.');
  }
  if (!houseId || houseId.length > 100) {
    throw new HttpsError('invalid-argument', 'Nhà không hợp lệ.');
  }

  return { email, fullName, holyName, role, houseId };
}

exports.createMemberAccount = onCall(async (request) => {
  const managerProfile = await requireHouseManager(request);
  const memberData = validateMemberData(request.data || {});
  if (memberData.houseId !== managerProfile.house_id) {
    throw new HttpsError('permission-denied', 'Không thể tạo tài khoản ngoài nhà của bạn.');
  }

  const password = String(request.data.password || '');
  if (password.length < 8 || password.length > 128) {
    throw new HttpsError('invalid-argument', 'Mật khẩu phải có từ 8 đến 128 ký tự.');
  }

  const householdProfiles = await db.collection('users')
    .where('house_id', '==', memberData.houseId)
    .get();
  const matchingProfiles = householdProfiles.docs.filter(
    (profile) => String(profile.data().email || '').trim().toLowerCase() === memberData.email,
  );
  if (matchingProfiles.length > 1) {
    throw new HttpsError('failed-precondition', 'Có nhiều hồ sơ dùng email này; hãy xử lý trùng lặp trước.');
  }
  const existingProfile = matchingProfiles[0] || null;
  if (existingProfile?.data().role === 'truongnha') {
    throw new HttpsError('failed-precondition', 'Không thể thay đổi tài khoản trưởng nhà từ danh sách thành viên.');
  }

  let userRecord;
  let createdAuthAccount = false;
  try {
    try {
      userRecord = await auth.getUserByEmail(memberData.email);
      if (userRecord.uid === request.auth.uid) {
        throw new HttpsError('failed-precondition', 'Không thể thay đổi mật khẩu trưởng nhà từ đây.');
      }
      const linkedProfile = await db.collection('users').doc(userRecord.uid).get();
      if (linkedProfile.exists && linkedProfile.data().house_id !== memberData.houseId) {
        throw new HttpsError('permission-denied', 'Email này đã được gán cho một nhà khác.');
      }
      if (linkedProfile.exists && linkedProfile.data().role === 'truongnha') {
        throw new HttpsError('failed-precondition', 'Không thể thay đổi tài khoản trưởng nhà từ danh sách thành viên.');
      }
      await auth.updateUser(userRecord.uid, {
        password,
        displayName: memberData.fullName,
      });
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (error.code !== 'auth/user-not-found') throw error;
      userRecord = await auth.createUser({
        email: memberData.email,
        password,
        displayName: memberData.fullName,
      });
      createdAuthAccount = true;
    }
  } catch (error) {
    if (error.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'Email này đã có tài khoản Firebase Authentication.');
    }
    if (error instanceof HttpsError) throw error;
    console.error('Could not create or link Firebase Auth user:', error);
    throw new HttpsError('internal', 'Không thể tạo tài khoản đăng nhập.');
  }

  const userRef = db.collection('users').doc(userRecord.uid);
  try {
    const profile = {
      uid: userRecord.uid,
      email: memberData.email,
      full_name: memberData.fullName,
      holy_name: memberData.holyName,
      role: memberData.role,
      house_id: memberData.houseId,
      created_by: request.auth.uid,
      updated_at: FieldValue.serverTimestamp(),
    };
    if (existingProfile?.id === userRecord.uid) {
      profile.created_at = existingProfile.data().created_at || FieldValue.serverTimestamp();
    } else {
      profile.created_at = FieldValue.serverTimestamp();
    }
    const batch = db.batch();
    batch.set(userRef, profile);
    if (existingProfile && existingProfile.id !== userRecord.uid) {
      batch.delete(existingProfile.ref);
    }
    await batch.commit();
  } catch (error) {
    if (createdAuthAccount) {
      try {
        await auth.deleteUser(userRecord.uid);
      } catch (cleanupError) {
        console.error('Could not roll back newly created Auth user:', cleanupError);
      }
    }
    console.error('Could not create Firestore user profile:', error);
    throw new HttpsError('internal', 'Tài khoản tạo chưa hoàn tất; vui lòng thử lại.');
  }

  return { uid: userRecord.uid };
});

exports.updateMemberAccount = onCall(async (request) => {
  const managerProfile = await requireHouseManager(request);
  const data = request.data || {};
  const uid = String(data.uid || '');
  if (!uid) {
    throw new HttpsError('invalid-argument', 'Thiếu mã thành viên.');
  }
  const memberRef = db.collection('users').doc(uid);
  const memberSnapshot = await memberRef.get();
  if (!memberSnapshot.exists || memberSnapshot.data().house_id !== managerProfile.house_id) {
    throw new HttpsError('not-found', 'Không tìm thấy thành viên trong nhà.');
  }
  if (uid === request.auth.uid) {
    throw new HttpsError('failed-precondition', 'Không thể tự chỉnh sửa tài khoản đang đăng nhập.');
  }
  if (memberSnapshot.data().role === 'truongnha') {
    throw new HttpsError('failed-precondition', 'Không thể chỉnh sửa tài khoản trưởng nhà từ danh sách thành viên.');
  }

  const memberData = validateMemberData({
    ...data,
    house_id: memberSnapshot.data().house_id,
  });
  try {
    await auth.updateUser(uid, {
      email: memberData.email,
      displayName: memberData.fullName,
    });
    await memberRef.update({
      email: memberData.email,
      full_name: memberData.fullName,
      holy_name: memberData.holyName,
      role: memberData.role,
      updated_at: FieldValue.serverTimestamp(),
      updated_by: request.auth.uid,
    });
  } catch (error) {
    if (error.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'Email này đã được tài khoản khác sử dụng.');
    }
    if (error.code === 'auth/user-not-found') {
      throw new HttpsError('failed-precondition', 'Tài khoản này chưa tồn tại trong Firebase Authentication.');
    }
    console.error('Could not update member account:', error);
    throw new HttpsError('internal', 'Không thể cập nhật tài khoản thành viên.');
  }
  return { uid };
});

exports.deleteMemberAccount = onCall(async (request) => {
  const managerProfile = await requireHouseManager(request);
  const uid = String(request.data?.uid || '');
  if (!uid) {
    throw new HttpsError('invalid-argument', 'Thiếu mã thành viên.');
  }
  if (uid === request.auth.uid) {
    throw new HttpsError('failed-precondition', 'Không thể xóa tài khoản đang đăng nhập.');
  }

  let memberRef = db.collection('users').doc(uid);
  let memberSnapshot = await memberRef.get();
  if (!memberSnapshot.exists || memberSnapshot.data().house_id !== managerProfile.house_id) {
    throw new HttpsError('not-found', 'Không tìm thấy thành viên trong nhà.');
  }

  const member = memberSnapshot.data();
  if (member.role === 'truongnha') {
    throw new HttpsError('failed-precondition', 'Không thể xóa tài khoản trưởng nhà từ danh sách thành viên.');
  }

  let authUid = uid;
  if (memberSnapshot.data().uid !== uid) {
    try {
      const authUser = await auth.getUserByEmail(memberSnapshot.data().email);
      const linkedProfile = await db.collection('users').doc(authUser.uid).get();
      if (linkedProfile.exists && linkedProfile.data().house_id !== managerProfile.house_id) {
        throw new HttpsError('permission-denied', 'Email này đã được gán cho một nhà khác.');
      }
      authUid = authUser.uid;
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
      authUid = '';
    }
  }

  try {
    if (authUid) await auth.deleteUser(authUid);
    await memberRef.delete();
    if (authUid && authUid !== uid) {
      const linkedProfileRef = db.collection('users').doc(authUid);
      const linkedProfile = await linkedProfileRef.get();
      if (linkedProfile.exists && linkedProfile.data().house_id === managerProfile.house_id) {
        await linkedProfileRef.delete();
      }
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('Could not finish deleting member account:', error);
    throw new HttpsError('internal', 'Không thể xóa hoàn tất tài khoản thành viên. Hãy thử lại.');
  }

  return { uid };
});
