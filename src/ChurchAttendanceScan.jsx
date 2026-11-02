import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, List, Spin, Tag, Typography, message } from 'antd';
import { CheckCircleOutlined, UserOutlined } from '@ant-design/icons';
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import dayjs from 'dayjs';
import { db } from './firebase';
import './ChurchAttendanceScan.css';

const { Text, Title } = Typography;

function getSessionId(houseId, date) {
  return `${encodeURIComponent(houseId)}_${date}`;
}

export default function ChurchAttendanceScan() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const houseId = params.get('house') || '';
  const date = params.get('date') || '';
  const token = params.get('token') || '';
  const [session, setSession] = useState(null);
  const [selectedMember, setSelectedMember] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    async function loadSession() {
      if (!houseId || !date || !token) {
        setLoading(false);
        return;
      }
      try {
        const snapshot = await getDoc(doc(db, 'church_attendance_qr', getSessionId(houseId, date)));
        if (active && snapshot.exists()) setSession(snapshot.data());
      } catch (error) {
        console.error('Không thể tải phiên điểm danh QR:', error);
        if (active) message.error('Không thể tải danh sách điểm danh.');
      } finally {
        if (active) setLoading(false);
      }
    }
    loadSession();
    return () => {
      active = false;
    };
  }, [date, houseId, token]);

  useEffect(() => {
    if (!session) return undefined;
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session]);

  const isExpired = !session?.expires_at?.toMillis || session.expires_at.toMillis() <= currentTime;
  const isValid = Boolean(
    session
      && session.active === true
      && session.house_id === houseId
      && session.date === date
      && session.token === token
      && !isExpired,
  );
  const members = [...(session?.members || [])].sort((first, second) => (
    (first.full_name || first.holy_name || '').localeCompare(
      second.full_name || second.holy_name || '',
      'vi',
    )
  ));

  async function submitAttendance() {
    if (!selectedMember || !isValid) return;
    setSaving(true);
    try {
      const sessionRef = doc(db, 'church_attendance_qr', getSessionId(houseId, date));
      const attendanceRef = doc(
        db,
        'church_attendance',
        `${encodeURIComponent(houseId)}_${date}_${encodeURIComponent(selectedMember.id)}`,
      );
      const nextToken = `${crypto.randomUUID()}${crypto.randomUUID()}`;
      await runTransaction(db, async (transaction) => {
        const sessionSnapshot = await transaction.get(sessionRef);
        if (!sessionSnapshot.exists() || sessionSnapshot.data().token !== token) {
          throw new Error('QR_USED_OR_EXPIRED');
        }
        const member = (sessionSnapshot.data().members || []).find(
          (item) => item.id === selectedMember.id,
        );
        if (!member) throw new Error('MEMBER_NOT_IN_SESSION');

        transaction.create(attendanceRef, {
          house_id: houseId,
          date,
          member_id: selectedMember.id,
          member_name: member.full_name || member.holy_name || 'Thành viên',
          attended: true,
          status: 'present',
          reason: '',
          session_id: getSessionId(houseId, date),
          session_token: token,
          recorded_by: '',
          updated_at: serverTimestamp(),
        });
        transaction.update(sessionRef, {
          token: nextToken,
          token_version: (sessionSnapshot.data().token_version || 0) + 1,
          scan_count: (sessionSnapshot.data().scan_count || 0) + 1,
          last_scanned_member_name: member.full_name || member.holy_name || 'Thành viên',
          last_scanned_at: serverTimestamp(),
        });
      });
      setCompleted(true);
    } catch (error) {
      console.error('Không thể ghi nhận điểm danh QR:', error);
      const errorMessage = error?.message === 'ALREADY_EXISTS'
        || error?.code === 'already-exists'
        || String(error?.message || '').toLowerCase().includes('already exists')
        ? 'Tên này đã được điểm danh rồi.'
        : error?.message === 'QR_USED_OR_EXPIRED'
            ? 'Mã QR vừa được sử dụng hoặc đã hết hạn. Vui lòng quét mã mới.'
            : 'Không thể ghi nhận điểm danh. Vui lòng thử lại.';
      message.error(errorMessage);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="church-attendance-scan">
      <Card bordered={false} className="church-attendance-scan__card">
        <div className="church-attendance-scan__brand">
          <CheckCircleOutlined />
          <Text>DONRUA HOME</Text>
        </div>
        <Title level={2}>Điểm danh đi lễ</Title>
        <Text type="secondary">
          {date ? `Ngày ${dayjs(date).format('DD/MM/YYYY')}` : 'Chọn tên của bạn để ghi nhận có mặt'}
        </Text>

        {loading && <div className="church-attendance-scan__loading"><Spin size="large" /></div>}
        {!loading && !isValid && (
          <Alert
            showIcon
            type="error"
            message="Mã QR không còn hiệu lực"
            description="Vui lòng nhờ Trưởng nhà tạo mã QR mới."
          />
        )}
        {!loading && isValid && !completed && (
          <>
            <Alert
              showIcon
              type="info"
              message="Chọn tên của bạn"
              description="Sau đó bấm nút xác nhận để hệ thống tính có mặt."
              className="church-attendance-scan__notice"
            />
            <List
              className="church-attendance-scan__members"
              bordered
              dataSource={members}
              locale={{ emptyText: <Empty description="Chưa có danh sách thành viên." /> }}
              renderItem={(member) => (
                <List.Item
                  className={selectedMember?.id === member.id ? 'is-selected' : ''}
                  onClick={() => setSelectedMember(member)}
                >
                  <List.Item.Meta
                    avatar={<UserOutlined />}
                    title={member.full_name || member.holy_name || 'Chưa có tên'}
                    description={member.holy_name && member.full_name ? member.holy_name : null}
                  />
                  {selectedMember?.id === member.id && <Tag color="green">Đã chọn</Tag>}
                </List.Item>
              )}
            />
            <Button
              type="primary"
              size="large"
              block
              disabled={!selectedMember}
              loading={saving}
              onClick={submitAttendance}
            >
              Xác nhận có mặt
            </Button>
          </>
        )}
        {completed && (
          <div className="church-attendance-scan__success">
            <CheckCircleOutlined />
            <Title level={3}>Đã điểm danh thành công!</Title>
            <Text>{selectedMember.full_name || selectedMember.holy_name}</Text>
            <Text type="secondary">Bạn có thể đóng trang này.</Text>
          </div>
        )}
      </Card>
    </main>
  );
}
