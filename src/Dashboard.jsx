import React, { useState } from 'react';
import { Layout, Menu, Button, Card, Row, Col, Breadcrumb, Avatar, Typography, Space } from 'antd';
import { 
  HomeOutlined, CalendarOutlined, TeamOutlined, BarChartOutlined, 
  PlusOutlined, SyncOutlined, CheckCircleOutlined, BankOutlined, 
  LogoutOutlined, ClearOutlined, CoffeeOutlined 
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { auth } from './firebase';
import ManageMembers from './ManageMembers';
import MealSchedule from './MealSchedule';
import CleaningSchedule from './CleaningSchedule';
import ChurchAttendance from './ChurchAttendance';
import DataManagement from './DataManagement';

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

export default function Dashboard() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('currentUser')) || {};
  const [currentMenu, setCurrentMenu] = useState('1');

  const handleLogout = () => {
    auth.signOut();
    localStorage.clear();
    navigate('/login');
  };

  // Danh sách các mục trên Menu bên trái
  const menuItems = [
    { key: '1', icon: <HomeOutlined />, label: 'Tổng quan' },
    { key: '2', icon: <CoffeeOutlined />, label: 'Lịch nấu cơm' },
    { key: '3', icon: <ClearOutlined />, label: 'Lịch trực vệ sinh' },
    { key: '4', icon: <BankOutlined />, label: 'Điểm danh đi lễ' },
    { key: '5', icon: <TeamOutlined />, label: 'Thành viên' },
    { key: '6', icon: <BarChartOutlined />, label: 'Dữ liệu' },
  ];

  return (
    <Layout style={{ minHeight: '100vh', background: '#f9faf9' }}>
      {/* SIDER (THANH MENU BÊN TRÁI) */}
      <Sider 
        theme="light" 
        width={260} 
        style={{ borderRight: '1px solid #f0f0f0' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
        {/* Logo */}
        <div style={{ padding: '24px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ background: '#255e42', padding: 8, borderRadius: 8, color: 'white', fontSize: 20 }}>
            <HomeOutlined />
          </div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16, color: '#1a1a1a', letterSpacing: 1 }}>DONRUA HOME</div>
            <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', marginTop: 2 }}>“Everything for the Lord!<br/> May His holy will be done!”</div>
          </div>
        </div>

        {/* Menu */}
        <div style={{ padding: '0 16px', fontSize: 12, color: '#a0a0a0', fontWeight: 'bold', marginBottom: 8, marginTop: 10 }}>
          KHÔNG GIAN CHUNG
        </div>
        <Menu 
          mode="inline" 
          selectedKeys={[currentMenu]} 
          onClick={(e) => setCurrentMenu(e.key)}
          style={{ borderRight: 0, padding: '0 8px' }}
          items={menuItems}
        />

        {/* Bottom Profile */}
        <div style={{ marginTop: 'auto', padding: 20, borderTop: '1px solid #f0f0f0' }}>
          <div style={{ background: '#f5f5f5', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onClick={handleLogout}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar style={{ backgroundColor: '#255e42', color: '#fff', fontWeight: 'bold' }}>
                TD
              </Avatar>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>{user.full_name || 'ADMIN'}</div>
                <div style={{ fontSize: 11, color: '#888' }}>DONRUA HOME</div>
              </div>
            </div>
            <LogoutOutlined style={{ color: '#888' }} />
          </div>
        </div>
        </div>
      </Sider>

      <Layout>
        {/* HEADER */}
        <Header style={{ background: '#fff', padding: '0 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 72, borderBottom: '1px solid #f0f0f0' }}>
          <Breadcrumb separator="/">
            <Breadcrumb.Item style={{ color: '#888' }}>DONRUA HOME</Breadcrumb.Item>
            <Breadcrumb.Item style={{ fontWeight: 600, color: '#333' }}>
              {menuItems.find(m => m.key === currentMenu)?.label || 'Tổng quan'}
            </Breadcrumb.Item>
          </Breadcrumb>
          <Space size="middle">
            <Button icon={<SyncOutlined />} shape="circle" onClick={() => window.location.reload()} />
            <Avatar style={{ backgroundColor: '#255e42', color: '#fff', fontWeight: 'bold' }}>
              TD
            </Avatar>
          </Space>
        </Header>

        {/* NỘI DUNG CHÍNH (CONTENT) */}
        <Content style={{ padding: '32px 48px', overflowY: 'auto' }}>
          {/* Màn hình 5: Quản lý thành viên */}
          {currentMenu === '5' && <ManageMembers />}

          {/* Màn hình 2: Lịch nấu cơm */}
          {currentMenu === '2' && <MealSchedule />}

          {/* Màn hình 3: Lịch trực vệ sinh */}
          {currentMenu === '3' && <CleaningSchedule />}

          {/* Màn hình 4: Điểm danh đi lễ */}
          {currentMenu === '4' && <ChurchAttendance />}

          {/* Màn hình 6: Dữ liệu */}
          {currentMenu === '6' && <DataManagement />}

          {/* Màn hình 1: Tổng quan */}
          {currentMenu === '1' && (
            <>
              {/* Tiêu đề & Nút thêm lịch */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
                <div>
                  <Text style={{ fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Nhà Don Rua của chúng mình</Text>
                  <Title level={2} style={{ margin: '4px 0 8px 0', color: '#1a1a1a' }}>MY HOME</Title>
                </div>
                <Button type="primary" icon={<PlusOutlined />} style={{ background: '#255e42', borderRadius: 8, height: 40, padding: '0 20px', fontWeight: 500 }}>
                  Thêm lịch
                </Button>
              </div>

              {/* Banner xanh */}
              <div style={{ background: '#edf3f0', borderRadius: 16, padding: '32px 40px', marginBottom: 24, position: 'relative', overflow: 'hidden' }}>
                <Text style={{ fontSize: 13, color: '#55826b', fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>Mỗi người một tay</Text>
                <Title level={3} style={{ color: '#1a1a1a', marginTop: 8, marginBottom: 16 }}>Nhà gọn gàng. Bữa cơm ấm áp.</Title>
                <Text style={{ color: '#555', display: 'block' }}>Hôm nay có 0 ca cần cùng nhau chăm lo.</Text>
                <Text style={{ color: '#555', display: 'block' }}>Chia sẻ việc nhỏ, gắn kết mỗi ngày.</Text>
                
                {/* Hình minh họa ngôi nhà */}
                <div style={{ position: 'absolute', right: 40, bottom: -10, opacity: 0.8 }}>
                  <svg width="200" height="150" viewBox="0 0 200 150" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M100 20 L180 80 H160 V150 H40 V80 H20 Z" fill="#d2e3d8"/>
                    <rect x="70" y="100" width="30" height="50" fill="#edf3f0"/>
                    <rect x="120" y="90" width="20" height="20" fill="#edf3f0"/>
                    <rect x="40" y="90" width="20" height="20" fill="#edf3f0"/>
                    <circle cx="160" cy="40" r="10" fill="#f0dbb9"/>
                  </svg>
                </div>
              </div>

              {/* 4 Thẻ Thống Kê */}
              <Row gutter={24} style={{ marginBottom: 24 }}>
                {[
                  { title: 'Thành viên đang sinh hoạt', num: '15', sub: '/ 15', desc: 'Cùng nhau chia sẻ việc nhà', icon: <TeamOutlined /> },
                  { title: 'Ca nấu cơm tuần này', num: '0', sub: 'ca', desc: 'Trưa và tối mỗi ngày', icon: <CoffeeOutlined /> },
                  { title: 'Việc vệ sinh hoàn thành', num: '0', sub: '/ 0', desc: 'Tính theo tuần hiện tại', icon: <CheckCircleOutlined /> },
                  { title: 'Lượt có mặt đi lễ', num: '0', sub: 'lượt', desc: 'Chưa có điểm danh tuần này', icon: <BankOutlined /> }
                ].map((stat, idx) => (
                  <Col span={6} key={idx}>
                    <Card bordered={true} style={{ borderRadius: 12, borderColor: '#eaeaea' }} bodyStyle={{ padding: 20 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888', marginBottom: 12 }}>
                        <span style={{ fontSize: 13 }}>{stat.title}</span>
                        {stat.icon}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 8 }}>
                        <span style={{ fontSize: 32, fontWeight: 700, color: '#1a1a1a', lineHeight: 1 }}>{stat.num}</span>
                        <span style={{ color: '#888', fontSize: 14 }}>{stat.sub}</span>
                      </div>
                      <Text style={{ color: '#aaa', fontSize: 12 }}>{stat.desc}</Text>
                    </Card>
                  </Col>
                ))}
              </Row>

              {/* Lịch hôm nay & Buổi lễ sắp tới */}
              <Row gutter={24}>
                <Col span={16}>
                  <Card bordered={true} style={{ borderRadius: 12, borderColor: '#eaeaea', height: '100%' }} bodyStyle={{ padding: 24 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 40 }}>
                      <strong style={{ fontSize: 16 }}>Lịch nấu cơm & Vệ sinh hôm nay</strong>
                    </div>
                    <div style={{ textAlign: 'center', padding: '20px 0' }}>
                      <CalendarOutlined style={{ fontSize: 32, color: '#ccc', marginBottom: 16 }} />
                      <div style={{ color: '#888', marginBottom: 20 }}>Hôm nay chưa có lịch phân công.</div>
                      <Button type="dashed" icon={<PlusOutlined />} style={{ background: '#f4f7f5', borderColor: '#d3e0d8', color: '#255e42', padding: '0 24px', height: 40, borderRadius: 8 }}>
                        Tự động chia lịch
                      </Button>
                    </div>
                  </Card>
                </Col>
                
                <Col span={8}>
                  <Card bordered={true} style={{ borderRadius: 12, borderColor: '#eaeaea', height: '100%' }} bodyStyle={{ padding: 24 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 40 }}>
                      <strong style={{ fontSize: 16 }}>Buổi lễ sắp tới</strong>
                      <BankOutlined style={{ color: '#888' }} />
                    </div>
                    <div style={{ textAlign: 'center', padding: '20px 0' }}>
                      <BankOutlined style={{ fontSize: 32, color: '#ccc', marginBottom: 16 }} />
                      <div style={{ color: '#888', marginBottom: 20 }}>Chưa có buổi lễ sắp tới.</div>
                      <Button type="dashed" icon={<PlusOutlined />} style={{ background: '#f4f7f5', borderColor: '#d3e0d8', color: '#255e42', padding: '0 24px', height: 40, borderRadius: 8 }}>
                        Thêm buổi lễ
                      </Button>
                    </div>
                  </Card>
                </Col>
              </Row>
            </>
          )}
        </Content>
      </Layout>
    </Layout>
  );
}