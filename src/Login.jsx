import React, { useState } from 'react';
import { Form, Input, Button, message } from 'antd';
import { UserOutlined, LockOutlined, HomeOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  verifyBeforeUpdateEmail,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { auth, db } from './firebase';

async function activateInvitedAccount(user) {
  if (!user.email) {
    throw new Error('Tài khoản Firebase chưa có email đăng nhập.');
  }

  const profileRef = doc(db, 'users', user.uid);
  const email = user.email.trim().toLowerCase();
  const invitesRef = collection(db, 'member_account_invites');
  const emailInviteRef = doc(invitesRef, email);
  let profileData;

  await runTransaction(db, async (transaction) => {
    const profileSnapshot = await transaction.get(profileRef);
    if (profileSnapshot.exists()) {
      profileData = profileSnapshot.data();
      return;
    }

    let inviteSnapshot = await transaction.get(emailInviteRef);
    if (!inviteSnapshot.exists()) {
      const matchingInvites = await transaction.get(
        query(invitesRef, where('email', '==', email)),
      );
      if (matchingInvites.empty) {
        throw new Error('Email này chưa được Trưởng nhà mời tạo tài khoản.');
      }
      if (matchingInvites.size > 1) {
        throw new Error('Có nhiều lời mời cho email này. Nhờ Trưởng nhà xóa lời mời trùng và tạo lại.');
      }
      [inviteSnapshot] = matchingInvites.docs;
    }
    const invitation = inviteSnapshot.data();
    if (invitation.email !== email) {
      throw new Error('Email đăng nhập không khớp với lời mời.');
    }

    profileData = {
      uid: user.uid,
      email: invitation.email,
      full_name: invitation.full_name,
      holy_name: invitation.holy_name || '',
      role: invitation.role,
      house_id: invitation.house_id,
      invite_id: invitation.invite_id,
      created_by: invitation.invited_by,
      created_at: serverTimestamp(),
    };
    transaction.set(profileRef, profileData);
    transaction.update(inviteSnapshot.ref, {
      used_by: user.uid,
      used_at: serverTimestamp(),
    });
  });

  return {
    ...profileData,
    uid: user.uid,
    created_at: new Date().toISOString(),
  };
}

export default function Login() {
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('login');
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const navigate = useNavigate();
  const [form] = Form.useForm();

  // Hiệu ứng 3D Tilt theo chuyển động chuột
  const handleMouseMove = (e) => {
    const { clientX, clientY } = e;
    const { innerWidth, innerHeight } = window;
    const x = (clientX / innerWidth - 0.5) * 20; // Nghiêng tối đa 20 deg
    const y = (clientY / innerHeight - 0.5) * -20;
    setMousePos({ x, y });
  };

  const handleLogin = async (values) => {
    setLoading(true);
    let accountAuthenticated = false;
    try {
      const email = values.email.trim().toLowerCase();
      if (mode === 'register') {
        let credential;
        let createdNewAccount = false;
        try {
          credential = await createUserWithEmailAndPassword(auth, email, values.password);
          createdNewAccount = true;
        } catch (error) {
          if (error.code !== 'auth/email-already-in-use') throw error;
          credential = await signInWithEmailAndPassword(auth, email, values.password);
        }
        accountAuthenticated = true;
        let userData;
        try {
          userData = await activateInvitedAccount(credential.user);
        } catch (error) {
          if (createdNewAccount) {
            await deleteUser(credential.user);
            accountAuthenticated = false;
          }
          throw error;
        }
        message.success(`Tài khoản đã tạo. Xin chào ${userData.full_name || email}!`);
        localStorage.setItem('currentUser', JSON.stringify(userData));
        navigate('/dashboard');
        return;
      }

      const userCredential = await signInWithEmailAndPassword(auth, email, values.password);
      accountAuthenticated = true;
      const user = userCredential.user;
      const uid = userCredential.user.uid;

      const userDocRef = doc(db, 'users', uid);
      const userDoc = await getDoc(userDocRef);

      let userData;
      if (userDoc.exists()) {
        userData = { ...userDoc.data(), uid };
        const emailChangeRef = doc(db, 'member_email_change_requests', uid);
        const emailChangeSnapshot = await getDoc(emailChangeRef);
        if (emailChangeSnapshot.exists()) {
          const emailChange = emailChangeSnapshot.data();
          const signedInEmail = user.email?.trim().toLowerCase();
          if (signedInEmail === emailChange.old_email) {
            await verifyBeforeUpdateEmail(user, emailChange.new_email);
            await auth.signOut();
            message.success(`Đã gửi liên kết xác minh đến ${emailChange.new_email}. Sau khi xác minh, hãy đăng nhập bằng email mới.`);
            return;
          }
          if (signedInEmail !== emailChange.new_email || !user.emailVerified) {
            await auth.signOut();
            message.error('Email tài khoản không khớp yêu cầu đổi email hoặc chưa được xác minh.');
            return;
          }

          await runTransaction(db, async (transaction) => {
            const [profileSnapshot, requestSnapshot] = await Promise.all([
              transaction.get(userDocRef),
              transaction.get(emailChangeRef),
            ]);
            if (!profileSnapshot.exists() || !requestSnapshot.exists()) {
              throw new Error('Yêu cầu đổi email không còn hiệu lực. Hãy đăng nhập lại.');
            }
            const latestRequest = requestSnapshot.data();
            if (
              latestRequest.old_email !== profileSnapshot.data().email
              || latestRequest.new_email !== signedInEmail
            ) {
              throw new Error('Yêu cầu đổi email đã thay đổi. Hãy liên hệ Trưởng nhà.');
            }
            transaction.update(userDocRef, { email: signedInEmail });
            transaction.delete(emailChangeRef);
          });
          userData.email = signedInEmail;
          message.success('Đã xác nhận email đăng nhập mới.');
        }
      } else {
        userData = await activateInvitedAccount(user);
      }

      if (!userData.house_id || !userData.role) {
        await auth.signOut();
        message.error('Tài khoản chưa được phân quyền trong hệ thống!');
        return;
      }
      message.success(`Chào mừng ${userData.full_name || user.email} trở lại!`);
      localStorage.setItem('currentUser', JSON.stringify(userData));
      navigate('/dashboard');
    } catch (error) {
      console.error('Không thể đăng nhập:', error);
      if (accountAuthenticated) await auth.signOut();
      if (error.code === 'auth/email-already-in-use') {
        message.error('Email đã có tài khoản. Hãy đăng nhập hoặc dùng chức năng quên mật khẩu.');
      } else if (error.code === 'auth/invalid-credential') {
        message.error(mode === 'register'
          ? 'Email này đã có tài khoản. Hãy đăng nhập hoặc chọn “Quên mật khẩu?” để đặt mật khẩu mới.'
          : 'Sai email hoặc mật khẩu!');
      } else if (error.code === 'permission-denied') {
        message.error('Không tìm thấy lời mời cho email này hoặc Firestore Rules chưa được cập nhật.');
      } else if (error.message.includes('mời')) {
        message.error(error.message);
      } else {
        message.error(error.message || 'Không thể đăng nhập. Vui lòng thử lại.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    const email = form.getFieldValue('email')?.trim().toLowerCase();
    if (!email) {
      message.warning('Nhập email đăng nhập trước khi đặt lại mật khẩu.');
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      message.success('Nếu email đã đăng ký, Firebase sẽ gửi liên kết đặt lại mật khẩu.');
    } catch (error) {
      console.error('Không thể gửi email đặt lại mật khẩu:', error);
      message.error('Không thể gửi email đặt lại mật khẩu. Hãy kiểm tra email và thử lại.');
    }
  };

  return (
    <div 
      onMouseMove={handleMouseMove}
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: 'radial-gradient(circle at 50% 50%, #1e3c2c 0%, #0d1a13 100%)',
        perspective: '1000px'
      }}
    >
      {/* CSS Nhúng Trực Tiếp Cho Các Chuyển Động Keyframes */}
      <style>{`
        @keyframes floatOrb1 {
          0%, 100% { transform: translate(0px, 0px) scale(1); }
          50% { transform: translate(60px, -40px) scale(1.15); }
        }
        @keyframes floatOrb2 {
          0%, 100% { transform: translate(0px, 0px) scale(1); }
          50% { transform: translate(-50px, 50px) scale(1.2); }
        }
        @keyframes pulseGlow {
          0%, 100% { opacity: 0.6; filter: blur(50px); }
          50% { opacity: 0.9; filter: blur(70px); }
        }
        .login-card-3d {
          transition: transform 0.15s ease-out, box-shadow 0.3s ease;
          transform-style: preserve-3d;
        }
        .custom-input .ant-input-affix-wrapper {
          border-radius: 12px !important;
          padding: 12px 16px !important;
          background: rgba(255, 255, 255, 0.8) !important;
          border: 1px solid rgba(255, 255, 255, 0.5) !important;
          backdrop-filter: blur(10px);
          transition: all 0.3s ease;
        }
        .custom-input .ant-input-affix-wrapper:hover,
        .custom-input .ant-input-affix-wrapper-focused {
          border-color: #255e42 !important;
          box-shadow: 0 0 15px rgba(37, 94, 66, 0.3) !important;
          background: #ffffff !important;
        }
        .btn-3d-login {
          background: linear-gradient(135deg, #255e42 0%, #388e60 100%) !important;
          border: none !important;
          border-radius: 12px !important;
          height: 50px !important;
          font-weight: 700 !important;
          font-size: 16px !important;
          letter-spacing: 0.5px;
          box-shadow: 0 10px 25px rgba(37, 94, 66, 0.4) !important;
          transition: all 0.3s ease !important;
        }
        .btn-3d-login:hover {
          transform: translateY(-3px) scale(1.02);
          box-shadow: 0 15px 35px rgba(37, 94, 66, 0.6) !important;
        }
      `}</style>

      {/* CÁC CẦU NĂNG LƯỢNG 3D PHÁT SÁNG NỀN */}
      <div style={{
        position: 'absolute',
        width: 400,
        height: 400,
        borderRadius: '50%',
        background: 'radial-gradient(circle, #388e60 0%, rgba(37,94,66,0) 70%)',
        top: '10%',
        left: '15%',
        animation: 'floatOrb1 12s infinite ease-in-out, pulseGlow 6s infinite ease-in-out'
      }} />

      <div style={{
        position: 'absolute',
        width: 500,
        height: 500,
        borderRadius: '50%',
        background: 'radial-gradient(circle, #1b432e 0%, rgba(13,26,19,0) 70%)',
        bottom: '5%',
        right: '10%',
        animation: 'floatOrb2 15s infinite ease-in-out, pulseGlow 8s infinite ease-in-out'
      }} />

      {/* THẺ FORM ĐĂNG NHẬP 3D GLASSMORPHISM */}
      <div 
        className="login-card-3d"
        style={{
          position: 'relative',
          width: 420,
          padding: '48px 36px',
          borderRadius: 24,
          background: 'rgba(255, 255, 255, 0.15)',
          backdropFilter: 'blur(25px)',
          WebkitBackdropFilter: 'blur(25px)',
          border: '1px solid rgba(255, 255, 255, 0.3)',
          boxShadow: '0 30px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.4)',
          transform: `rotateY(${mousePos.x}deg) rotateX(${mousePos.y}deg)`,
          zIndex: 10
        }}
      >
        {/* LOGO & THƯƠNG HIỆU */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 70,
            height: 70,
            borderRadius: 20,
            background: 'linear-gradient(135deg, #255e42 0%, #1c4530 100%)',
            color: '#fff',
            fontSize: 32,
            boxShadow: '0 10px 25px rgba(0,0,0,0.3), inset 0 2px 2px rgba(255,255,255,0.4)',
            marginBottom: 16
          }}>
            <HomeOutlined />
          </div>
          <h1 style={{ 
            color: '#ffffff', 
            fontSize: 26, 
            fontWeight: 800, 
            letterSpacing: 1.5, 
            margin: 0,
            textShadow: '0 2px 10px rgba(0,0,0,0.3)'
          }}>
            DONRUA HOME
          </h1>
          <p style={{ 
            color: 'rgba(255, 255, 255, 0.75)', 
            fontSize: 13, 
            margin: '6px 0 0 0',
            fontWeight: 500,
            letterSpacing: 0.5
          }}>
            “Everything for the Lord! May His holy will be done!”
          </p>
        </div>

        {/* FORM ĐĂNG NHẬP */}
        <Form
          form={form}
          name="login"
          onFinish={handleLogin}
          layout="vertical"
          className="custom-input"
        >
          <Form.Item 
            name="email" 
            rules={[{ required: true, type: 'email', message: 'Vui lòng nhập email hợp lệ!' }]}
            style={{ marginBottom: 20 }}
          >
            <Input 
              prefix={<UserOutlined style={{ color: '#255e42', fontSize: 18, marginRight: 8 }} />} 
              placeholder="Email đăng nhập" 
              size="large" 
            />
          </Form.Item>

          <Form.Item 
            name="password" 
            rules={[
              { required: true, message: 'Vui lòng nhập mật khẩu!' },
              ...(mode === 'register'
                ? [{ min: 8, message: 'Mật khẩu cần ít nhất 8 ký tự.' }]
                : []),
            ]}
            style={{ marginBottom: 28 }}
          >
            <Input.Password 
              prefix={<LockOutlined style={{ color: '#255e42', fontSize: 18, marginRight: 8 }} />} 
              placeholder="Mật khẩu" 
              size="large" 
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 12 }}>
            <Button 
              type="primary" 
              htmlType="submit" 
              block 
              loading={loading}
              className="btn-3d-login"
            >
              {mode === 'login' ? 'ĐĂNG NHẬP HỆ THỐNG' : 'TẠO TÀI KHOẢN THEO LỜI MỜI'}
            </Button>
          </Form.Item>
        </Form>
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <Button
            type="link"
            onClick={() => {
              setMode((currentMode) => (currentMode === 'login' ? 'register' : 'login'));
              form.resetFields(['password']);
            }}
          >
            {mode === 'login'
              ? 'Được Trưởng nhà mời? Tạo mật khẩu?'
              : 'Đã có tài khoản? Đăng nhập'}
          </Button>
          {mode === 'login' && (
            <Button type="link" onClick={handlePasswordReset}>
              Quên mật khẩu?
            </Button>
          )}
        </div>

        {/* CHÚ THÍCH BẢO MẬT BÊN DƯỚI */}
        <div style={{ 
          textAlign: 'center', 
          marginTop: 20, 
          color: 'rgba(255, 255, 255, 0.6)', 
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6
        }}>
          <SafetyCertificateOutlined style={{ color: '#55826b' }} />
          Hệ thống Quản lý Sinh viên lưu xá Don Bosco Sài Gòn
        </div>
      </div>
    </div>
  );
}