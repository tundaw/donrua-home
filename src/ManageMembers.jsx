import React, { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, Select, Tag, Popconfirm, message, Card } from 'antd';
import { UserAddOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { collection, addDoc, getDocs, deleteDoc, doc, query, where, updateDoc } from 'firebase/firestore';
import { db } from './firebase';

export default function ManageMembers() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const newLocal = useState(null);
  const [selectedMember, setSelectedMember] = newLocal;
  const [form] = Form.useForm();

  const currentUser = JSON.parse(localStorage.getItem('currentUser')) || {};

  // 1. Lấy danh sách thành viên từ Firestore
  const fetchMembers = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'users'), where('house_id', '==', currentUser.house_id || 'DON_RUA'));
      const querySnapshot = await getDocs(q);
      const list = [];
      querySnapshot.forEach((d) => {
        list.push({ id: d.id, ...d.data() });
      });
      setMembers(list);
    } catch (error) {
      message.error('Lỗi khi tải danh sách thành viên!');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchMembers();
  }, []);

  // 2. Thêm thành viên mới vào Firestore
  const handleAddMember = async (values) => {
    try {
      await addDoc(collection(db, 'users'), {
        holy_name: values.holy_name || '',
        full_name: values.full_name,
        email: values.email,
        role: values.role,
        house_id: currentUser.house_id || 'DON_RUA'
      });
      message.success(`Đã thêm ${values.full_name} thành công!`);
      setIsModalOpen(false);
      form.resetFields();
      fetchMembers();
    } catch (error) {
      message.error('Lỗi khi lưu dữ liệu!');
    }
  };

  const handleUpdateMember = async (values) => {
    if (!selectedMember) return;

    try {
      await updateDoc(doc(db, 'users', selectedMember.id), {
        holy_name: values.holy_name || '',
        full_name: values.full_name,
        email: values.email,
        role: values.role,
      });
      message.success(`Đã cập nhật ${values.full_name} thành công!`);
      setIsModalOpen(false);
      setSelectedMember(null);
      form.resetFields();
      fetchMembers();
    } catch (error) {
      console.error('Không thể cập nhật thành viên:', error);
      message.error('Lỗi khi cập nhật thông tin thành viên!');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteDoc(doc(db, 'users', id));
      message.success('Đã xóa thành viên!');
      setIsModalOpen(false);
      setSelectedMember(null);
      form.resetFields();
      fetchMembers();
    } catch (error) {
      message.error('Không thể xóa thành viên này!');
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

  // Định dạng hiển thị chức vụ
  const renderRoleTag = (role) => {
    switch (role) {
      case 'truongnha': return <Tag color="red">Trưởng nhà</Tag>;
      case 'phonha': return <Tag color="orange">Phó nhà</Tag>;
      case 'thuquy': return <Tag color="gold">Thủ quỹ</Tag>;
      default: return <Tag color="green">Sinh viên</Tag>;
    }
  };

  const columns = [
    { title: 'Tên Thánh', dataIndex: 'holy_name', key: 'holy_name', render: (t) => t || '---' },
    { title: 'Họ và Tên', dataIndex: 'full_name', key: 'full_name', render: (t) => <strong>{t}</strong> },
    { title: 'Email đăng nhập', dataIndex: 'email', key: 'email' },
    { title: 'Chức vụ', dataIndex: 'role', key: 'role', render: (role) => renderRoleTag(role) },
    {
      title: 'Thao tác',
      key: 'action',
      render: (_, record) => (
        <Button
          type="text"
          aria-label={`Chỉnh sửa ${record.full_name}`}
          icon={<EditOutlined />}
          onClick={() => openEditModal(record)}
        />
      )
    }
  ];

  return (
    <Card bordered={false} style={{ borderRadius: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, color: '#1a1a1a' }}>Danh Sách Thành Viên</h2>
          <span style={{ color: '#888' }}>Tổng số: <strong>{members.length} / 15</strong> người</span>
        </div>
        <Button 
          type="primary" 
          icon={<UserAddOutlined />} 
          onClick={openAddModal}
          style={{ background: '#255e42', borderRadius: 8, height: 40 }}
        >
          Thêm thành viên
        </Button>
      </div>

      <Table dataSource={members} columns={columns} rowKey="id" loading={loading} pagination={false} />

      <Modal 
        title={selectedMember ? 'Chỉnh sửa thành viên' : 'Thêm thành viên mới'}
        open={isModalOpen} 
        onCancel={() => {
          setIsModalOpen(false);
          setSelectedMember(null);
          form.resetFields();
        }}
        footer={null}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={selectedMember ? handleUpdateMember : handleAddMember}
        >
          <Form.Item name="holy_name" label="Tên Thánh">
            <Input placeholder="Ví dụ: Giuse, Maria..." />
          </Form.Item>

          <Form.Item name="full_name" label="Họ và tên" rules={[{ required: true, message: 'Nhập họ tên!' }]}>
            <Input placeholder="Ví dụ: Nguyễn Văn A" />
          </Form.Item>

          <Form.Item name="email" label="Email đăng nhập" rules={[{ required: true, type: 'email' }]}>
            <Input placeholder="nguyenvana@donrua.com" />
          </Form.Item>

          <Form.Item name="role" label="Chức vụ">
            <Select>
              <Select.Option value="truongnha">Trưởng nhà</Select.Option>
              <Select.Option value="phonha">Phó nhà</Select.Option>
              <Select.Option value="thuquy">Thủ quỹ</Select.Option>
              <Select.Option value="sinh_vien">Sinh viên</Select.Option>
            </Select>
          </Form.Item>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            {selectedMember && selectedMember.role !== 'truongnha' ? (
              <Popconfirm
                title="Xóa thành viên này?"
                onConfirm={() => handleDelete(selectedMember.id)}
                okText="Xóa"
                cancelText="Hủy"
              >
                <Button danger icon={<DeleteOutlined />}>Xóa thành viên</Button>
              </Popconfirm>
            ) : <span />}
            <Button type="primary" htmlType="submit" style={{ background: '#255e42', height: 40 }}>
              {selectedMember ? 'Lưu thay đổi' : 'Lưu vào hệ thống'}
            </Button>
          </div>
        </Form>
      </Modal>
    </Card>
  );
}