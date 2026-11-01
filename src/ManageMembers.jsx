import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  message,
  Modal,
  Select,
  Table,
  Tag,
} from 'antd';
import { EditOutlined, KeyOutlined, UserAddOutlined } from '@ant-design/icons';
import { onAuthStateChanged, sendPasswordResetEmail } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { canManageHouse } from './permissions';
import { deduplicateMemberProfiles } from './memberProfiles';

const MEMBER_ROLES = [
  { value: 'truongnha', label: 'Trưởng nhà' },
  { value: 'phonha', label: 'Phó nhà' },
  { value: 'thuquy', label: 'Thủ quỹ' },
  { value: 'sinh_vien', label: 'Sinh viên' },
];

export default function ManageMembers() {
  const currentUser = JSON.parse(localStorage.getItem('currentUser')) || {};
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [houseId, setHouseId] = useState('');
  const [canManageMembers, setCanManageMembers] = useState(false);
  const [emailChangeRequests, setEmailChangeRequests] = useState({});
  const [saving, setSaving] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [form] = Form.useForm();
  const [emailForm] = Form.useForm();

  useEffect(() => {
    let cancelled = false;
    let unsubscribeMembers = () => {};
    let unsubscribeEmailRequests = () => {};
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      unsubscribeMembers();
      unsubscribeEmailRequests();
      setMembers([]);
      setEmailChangeRequests({});
      setLoading(true);
      setLoadError('');

      if (!user) {
        setLoadError('Phiên đăng nhập không còn hiệu lực. Vui lòng đăng nhập lại.');
        setLoading(false);
        return;
      }

      try {
        const profileSnapshot = await getDoc(doc(db, 'users', user.uid));
        if (cancelled) return;
        if (!profileSnapshot.exists()) {
          setLoadError('Tài khoản chưa có hồ sơ thành viên trong hệ thống.');
          setLoading(false);
          return;
        }

        const profile = profileSnapshot.data();
        if (!profile.house_id) {
          setLoadError('Hồ sơ tài khoản chưa được gán vào nhà.');
          setLoading(false);
          return;
        }

        setHouseId(profile.house_id);
        setCanManageMembers(canManageHouse(profile.role));
        const memberQuery = query(
          collection(db, 'users'),
          where('house_id', '==', profile.house_id),
        );
        if (canManageHouse(profile.role)) {
          const emailRequestsQuery = query(
            collection(db, 'member_email_change_requests'),
            where('house_id', '==', profile.house_id),
          );
          unsubscribeEmailRequests = onSnapshot(
            emailRequestsQuery,
            (snapshot) => setEmailChangeRequests(Object.fromEntries(
              snapshot.docs.map((item) => [item.id, item.data()]),
            )),
            (error) => {
              console.error('Không thể tải yêu cầu đổi email:', error);
              message.error('Không thể tải trạng thái yêu cầu đổi email.');
            },
          );
        }
        unsubscribeMembers = onSnapshot(
          memberQuery,
          (snapshot) => {
            const profiles = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
            setMembers(deduplicateMemberProfiles(profiles, user.uid).members);
            setLoadError('');
            setLoading(false);
          },
          (error) => {
            console.error('Không thể tải danh sách thành viên:', error);
            setLoadError(error.code === 'permission-denied'
              ? 'Firestore chưa cho phép thành viên trong cùng nhà xem danh sách. Kiểm tra và triển khai Firestore Rules.'
              : 'Không thể tải danh sách thành viên. Vui lòng thử lại.');
            setLoading(false);
          },
        );
      } catch (error) {
        if (cancelled) return;
        console.error('Không thể xác định nhà của tài khoản:', error);
        setLoadError(error.code === 'permission-denied'
          ? 'Firestore từ chối đọc hồ sơ tài khoản. Kiểm tra Firestore Rules.'
          : 'Không thể tải hồ sơ tài khoản. Vui lòng thử lại.');
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      unsubscribeAuth();
      unsubscribeMembers();
      unsubscribeEmailRequests();
    };
  }, []);

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedMember(null);
    form.resetFields();
  };

  const closeEmailModal = () => {
    setEmailModalOpen(false);
    setSelectedMember(null);
    emailForm.resetFields();
  };

  const handleSaveMember = async (values) => {
    if (!canManageMembers) {
      message.error('Chỉ trưởng nhà mới được quản lý tài khoản.');
      return;
    }

    setSaving(true);
    try {
      const email = values.email.trim().toLowerCase();
      const inviteId = email;
      const inviteRef = doc(db, 'member_account_invites', inviteId);
      const invitation = {
        invite_id: inviteId,
        email,
        full_name: values.full_name.trim(),
        holy_name: values.holy_name?.trim() || '',
        role: values.role,
        house_id: houseId,
        invited_by: auth.currentUser.uid,
        invited_at: serverTimestamp(),
      };
      if (selectedMemberNeedsAccountSetup) {
        const batch = writeBatch(db);
        batch.update(doc(db, 'users', selectedMember.id), {
            full_name: invitation.full_name,
            holy_name: invitation.holy_name,
            role: invitation.role,
        });
        batch.set(inviteRef, invitation);
        await batch.commit();
      } else {
        await setDoc(inviteRef, invitation);
      }
      closeModal();
      message.success(selectedMemberNeedsAccountSetup
        ? `Đã lưu thay đổi thông tin và lời mời cho ${email}.`
        : `Đã tạo lời mời đăng nhập cho ${email}. Thành viên có thể đăng ký bằng đúng email này.`);
    } catch (error) {
      console.error('Không thể tạo lời mời tài khoản:', error);
      message.error(error.code === 'permission-denied'
        ? 'Firestore Rules chưa cho phép Trưởng nhà tạo lời mời. Hãy triển khai rules mới.'
        : error.message || 'Không thể tạo lời mời. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  const handleMemberAction = async (member) => {
    if (!canManageMembers) {
      message.error('Chỉ trưởng nhà mới được quản lý tài khoản.');
      return;
    }
    if (member.uid) {
      setSaving(true);
      try {
        await sendPasswordResetEmail(auth, member.email);
        message.success(`Đã gửi liên kết đặt lại mật khẩu đến ${member.email}.`);
      } catch (error) {
        console.error('Không thể gửi liên kết đặt lại mật khẩu:', error);
        message.error(error.code === 'auth/invalid-email'
          ? 'Email thành viên không hợp lệ.'
          : error.message || 'Không thể gửi email đặt lại mật khẩu.');
      } finally {
        setSaving(false);
      }
      return;
    }
    openEditModal(member);
  };

  const openEmailChangeModal = (member) => {
    setSelectedMember(member);
    emailForm.setFieldsValue({ email: member.email || '' });
    setEmailModalOpen(true);
  };

  const handleSaveEmailChange = async ({ email: requestedEmail }) => {
    if (!canManageMembers || !selectedMember || selectedMember.uid !== selectedMember.id) {
      message.error('Chỉ Trưởng nhà mới được yêu cầu đổi email cho tài khoản đã liên kết.');
      return;
    }

    const newEmail = requestedEmail.trim().toLowerCase();
    const oldEmail = String(selectedMember.email || '').trim().toLowerCase();
    if (newEmail === oldEmail) {
      message.info('Email mới giống email hiện tại.');
      return;
    }

    setSaving(true);
    try {
      await setDoc(doc(db, 'member_email_change_requests', selectedMember.uid), {
        uid: selectedMember.uid,
        old_email: oldEmail,
        new_email: newEmail,
        house_id: houseId,
        requested_by: auth.currentUser.uid,
        requested_at: serverTimestamp(),
      });
      message.success(`Đã lưu yêu cầu đổi email cho ${selectedMember.full_name}. Thành viên cần đăng nhập email cũ và xác minh email mới để hoàn tất.`);
      closeEmailModal();
    } catch (error) {
      console.error('Không thể lưu yêu cầu đổi email:', error);
      message.error(error.code === 'permission-denied'
        ? 'Firestore Rules chưa cho phép Trưởng nhà yêu cầu đổi email. Hãy triển khai rules mới.'
        : error.message || 'Không thể lưu yêu cầu đổi email.');
    } finally {
      setSaving(false);
    }
  };

  const openAddModal = () => {
    setSelectedMember(null);
    form.resetFields();
    form.setFieldsValue({ role: 'sinh_vien' });
    setIsModalOpen(true);
  };

  const openEditModal = (member) => {
    setSelectedMember(member);
    form.setFieldsValue({
      holy_name: member.holy_name || '',
      full_name: member.full_name || '',
      email: member.email || '',
      role: member.role || 'sinh_vien',
    });
    setIsModalOpen(true);
  };

  const renderRoleTag = (role) => {
    const roleLabel = MEMBER_ROLES.find((item) => item.value === role)?.label || 'Chưa rõ';
    const roleColor = role === 'truongnha' ? 'red' : role === 'phonha' ? 'orange' : 'green';
    return <Tag color={roleColor}>{roleLabel}</Tag>;
  };
  const selectedMemberNeedsAccountSetup = selectedMember
    && !selectedMember.uid;

  const columns = [
    { title: 'Tên Thánh', dataIndex: 'holy_name', key: 'holy_name', render: (value) => value || '---' },
    { title: 'Họ và Tên', dataIndex: 'full_name', key: 'full_name', render: (value) => <strong>{value}</strong> },
    {
      title: 'Email đăng nhập',
      dataIndex: 'email',
      key: 'email',
      render: (email, member) => (
        <div>
          <div>{email}</div>
          {emailChangeRequests[member.uid]?.new_email && (
            <Tag color="processing">
              {`Chờ xác minh: ${emailChangeRequests[member.uid].new_email}`}
            </Tag>
          )}
        </div>
      ),
    },
    { title: 'Chức vụ', dataIndex: 'role', key: 'role', render: renderRoleTag },
    ...(canManageMembers ? [{
      title: 'Thao tác',
      key: 'action',
      render: (_, member) => (
        member.id === currentUser.uid ? null : member.uid === member.id ? (
          <>
            <Button
              type="text"
              aria-label={`Đổi email đăng nhập cho ${member.full_name}`}
              icon={<EditOutlined />}
              onClick={() => openEmailChangeModal(member)}
            />
            <Button
              type="text"
              aria-label={`Gửi đặt lại mật khẩu cho ${member.full_name}`}
              icon={<KeyOutlined />}
              onClick={() => handleMemberAction(member)}
            />
          </>
        ) : (
          <Button
            type="text"
            aria-label={`Tạo lời mời đăng nhập cho ${member.full_name}`}
            icon={<EditOutlined />}
            onClick={() => handleMemberAction(member)}
          />
        )
      ),
    }] : []),
  ];

  return (
    <Card bordered={false} style={{ borderRadius: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, color: '#1a1a1a' }}>Danh Sách Thành Viên</h2>
          <span style={{ color: '#888' }}>Tổng số: <strong>{members.length} người</strong></span>
        </div>
        {canManageMembers && (
          <Button
            type="primary"
            icon={<UserAddOutlined />}
            onClick={openAddModal}
            style={{ background: '#255e42', borderRadius: 8, height: 40 }}
          >
            Mời thành viên
          </Button>
        )}
      </div>

      {!canManageMembers && (
        <Alert
          type="info"
          showIcon
          message="Bạn có thể xem danh sách thành viên cùng nhà. Chỉ Trưởng nhà mới được duyệt email và chức vụ để tạo lời mời đăng nhập."
          style={{ marginBottom: 16 }}
        />
      )}
      {loadError && (
        <Alert
          type="error"
          showIcon
          message={loadError}
          style={{ marginBottom: 16 }}
        />
      )}
      <Table dataSource={members} columns={columns} rowKey="id" loading={loading} pagination={false} />

      <Modal
        title={selectedMemberNeedsAccountSetup
          ? 'Chỉnh sửa thông tin thành viên'
          : selectedMember ? 'Cập nhật lời mời đăng nhập' : 'Tạo lời mời đăng nhập'}
        open={isModalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={saving}
        okText={selectedMemberNeedsAccountSetup ? 'Lưu thay đổi' : 'Tạo lời mời'}
        cancelText="Hủy"
      >
        <Form form={form} layout="vertical" onFinish={handleSaveMember}>
          <Form.Item name="holy_name" label="Tên Thánh">
            <Input maxLength={80} placeholder="Ví dụ: Giuse, Maria..." />
          </Form.Item>
          <Form.Item name="full_name" label="Họ và tên" rules={[{ required: true, whitespace: true, message: 'Nhập họ tên!' }]}>
            <Input maxLength={120} placeholder="Ví dụ: Nguyễn Văn A" />
          </Form.Item>
          <Form.Item name="email" label="Email đăng nhập" rules={[{ required: true, type: 'email', message: 'Nhập email hợp lệ.' }]}>
            <Input
              type="email"
              autoComplete="email"
              placeholder="nguyenvana@example.com"
              disabled={Boolean(selectedMemberNeedsAccountSetup)}
            />
          </Form.Item>
          <Form.Item name="role" label="Chức vụ" rules={[{ required: true, message: 'Chọn chức vụ.' }]}>
            <Select options={MEMBER_ROLES} />
          </Form.Item>
          {(!selectedMember || selectedMemberNeedsAccountSetup) && (
            <Alert
              type="info"
              showIcon
              message="Thành viên tự tạo mật khẩu bằng email đã được Trưởng nhà duyệt."
              description="Không cần xác minh email. Thành viên tạo mật khẩu bằng đúng email đã được mời."
              style={{ marginBottom: 16 }}
            />
          )}
        </Form>
      </Modal>
      <Modal
        title={`Yêu cầu đổi email · ${selectedMember?.full_name || ''}`}
        open={emailModalOpen}
        onCancel={closeEmailModal}
        onOk={() => emailForm.submit()}
        confirmLoading={saving}
        okText="Lưu email mới"
        cancelText="Hủy"
      >
        <Form form={emailForm} layout="vertical" onFinish={handleSaveEmailChange}>
          <Form.Item label="Email hiện tại">
            <Input value={selectedMember?.email || ''} disabled />
          </Form.Item>
          <Form.Item
            name="email"
            label="Email đăng nhập mới"
            rules={[
              { required: true, type: 'email', message: 'Nhập email hợp lệ.' },
              { max: 254, message: 'Email không được vượt quá 254 ký tự.' },
            ]}
          >
            <Input type="email" autoComplete="email" placeholder="tenmoi@example.com" />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            message="Email đăng nhập chỉ đổi sau khi thành viên xác minh."
            description="Lưu sẽ gửi yêu cầu. Thành viên cần đăng nhập bằng email hiện tại, mở email xác minh gửi đến địa chỉ mới, rồi đăng nhập bằng email mới."
          />
        </Form>
      </Modal>
    </Card>
  );
}
