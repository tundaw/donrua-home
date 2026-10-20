import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Empty,
  Input,
  message,
  Modal,
  Popconfirm,
  QRCode,
  Select,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import { BankOutlined, QrcodeOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import './ChurchAttendance.css';

const { Text, Title } = Typography;
const { TextArea } = Input;
const WEEKDAYS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
const QR_AUTHORIZED_ROLES = new Set(['admin', 'administrator', 'truongnha']);
const QR_VALIDITY_MS = 5 * 60 * 1000;

function normalizeRole(role) {
  return String(role || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function isQrAuthorizedRole(role) {
  return QR_AUTHORIZED_ROLES.has(normalizeRole(role));
}

function getInitialAttendanceDate() {
  const today = dayjs();
  return today.day() === 0 ? today.subtract(1, 'day') : today;
}

function createAttendanceToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function getQrExpiryTime(session) {
  const expiryFromField = session?.expires_at?.toMillis
    ? session.expires_at.toMillis()
    : Number.POSITIVE_INFINITY;
  const expiryFromCreation = session?.created_at?.toMillis
    ? session.created_at.toMillis() + QR_VALIDITY_MS
    : Number.POSITIVE_INFINITY;
  const expiry = Math.min(expiryFromField, expiryFromCreation);
  return Number.isFinite(expiry) ? expiry : 0;
}

function formatTimeRemaining(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

export default function ChurchAttendance() {
  const currentUser = JSON.parse(localStorage.getItem('currentUser')) || {};
  const storedRole = normalizeRole(currentUser.role);
  const houseId = currentUser.house_id || 'DON_RUA';
  const [selectedDate, setSelectedDate] = useState(getInitialAttendanceDate);
  const [members, setMembers] = useState([]);
  const [attendance, setAttendance] = useState({});
  const [monthAttendance, setMonthAttendance] = useState([]);
  const [absenceMember, setAbsenceMember] = useState(null);
  const [absenceStatus, setAbsenceStatus] = useState('absent_unexcused');
  const [absenceReason, setAbsenceReason] = useState('');
  const [qrSession, setQrSession] = useState(null);
  const [isQrVisible, setIsQrVisible] = useState(false);
  const [canManageQr, setCanManageQr] = useState(() => isQrAuthorizedRole(storedRole));
  const [loading, setLoading] = useState(false);
  const [savingQr, setSavingQr] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const autoRenewedTokenRef = useRef(null);
  const dateKey = selectedDate.format('YYYY-MM-DD');
  const monthStartKey = selectedDate.startOf('month').format('YYYY-MM-DD');
  const monthEndKey = selectedDate.endOf('month').format('YYYY-MM-DD');
  const weekday = WEEKDAYS[selectedDate.day()];
  const qrSessionRef = useMemo(
    () => doc(db, 'church_attendance_qr', `${encodeURIComponent(houseId)}_${dateKey}`),
    [dateKey, houseId],
  );
  const qrExpiresAt = getQrExpiryTime(qrSession);
  const qrTimeRemaining = Math.max(0, qrExpiresAt - currentTime);
  const qrExpired = Boolean(qrSession) && qrTimeRemaining === 0;
  const qrPayload = qrSession
    && !qrExpired
    ? JSON.stringify({
      type: 'church-attendance',
      houseId,
      date: dateKey,
      token: qrSession.token,
      tokenVersion: qrSession.token_version || 1,
    })
    : '';

  useEffect(() => {
    if (!qrSession) return undefined;
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [qrSession]);

  const fetchAttendance = useCallback(async () => {
    setLoading(true);
    setCanManageQr(isQrAuthorizedRole(storedRole));
    try {
      const uid = auth.currentUser?.uid;
      const monthlyAttendanceQuery = query(
        collection(db, 'church_attendance'),
        where('house_id', '==', houseId),
        where('date', '>=', monthStartKey),
        where('date', '<=', monthEndKey),
      );
      const [membersSnapshot, attendanceSnapshot, monthlyAttendanceSnapshot, qrSnapshot, userSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('house_id', '==', houseId))),
        getDocs(query(
          collection(db, 'church_attendance'),
          where('house_id', '==', houseId),
          where('date', '==', dateKey),
        )),
        getDocs(monthlyAttendanceQuery),
        getDoc(qrSessionRef),
        uid ? getDoc(doc(db, 'users', uid)) : Promise.resolve(null),
      ]);
      const nextMembers = membersSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
        .sort((first, second) => (
          (first.full_name || first.holy_name || '').localeCompare(
            second.full_name || second.holy_name || '',
            'vi',
          )
        ));
      const nextAttendance = Object.fromEntries(
        attendanceSnapshot.docs.map((item) => [item.data().member_id, { id: item.id, ...item.data() }]),
      );
      const nextMonthAttendance = monthlyAttendanceSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      const role = userSnapshot?.data()?.role || currentUser.role;
      setMembers(nextMembers);
      setAttendance(nextAttendance);
      setMonthAttendance(nextMonthAttendance);
      setQrSession(qrSnapshot.exists() ? qrSnapshot.data() : null);
      setCanManageQr(isQrAuthorizedRole(role));
    } catch (error) {
      console.error('Không thể tải điểm danh đi lễ:', error);
      message.error('Không thể tải danh sách điểm danh. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }, [currentUser.role, dateKey, houseId, monthEndKey, monthStartKey, qrSessionRef, storedRole]);

  useEffect(() => {
    fetchAttendance();
  }, [fetchAttendance]);

  useEffect(() => {
    const attendanceQuery = query(
      collection(db, 'church_attendance'),
      where('house_id', '==', houseId),
      where('date', '>=', monthStartKey),
      where('date', '<=', monthEndKey),
    );
    const unsubscribeAttendance = onSnapshot(
      attendanceQuery,
      (snapshot) => {
        const monthRecords = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        setMonthAttendance(monthRecords);
        setAttendance(Object.fromEntries(
          monthRecords
            .filter((record) => record.date === dateKey)
            .map((record) => [record.member_id, record]),
        ));
      },
      (error) => {
        console.error('Không thể đồng bộ điểm danh đi lễ:', error);
        message.error('Không thể cập nhật trạng thái điểm danh trực tiếp.');
      },
    );
    const unsubscribeQr = onSnapshot(
      qrSessionRef,
      (snapshot) => {
        setQrSession(snapshot.exists() ? snapshot.data() : null);
      },
      (error) => {
        console.error('Không thể đồng bộ mã QR điểm danh:', error);
        message.error('Không thể cập nhật mã QR trực tiếp.');
      },
    );

    return () => {
      unsubscribeAttendance();
      unsubscribeQr();
    };
  }, [dateKey, houseId, monthEndKey, monthStartKey, qrSessionRef]);

  const presentCount = useMemo(
    () => members.filter((member) => attendance[member.id]?.attended === true).length,
    [attendance, members],
  );

  const presentRecords = useMemo(
    () => members.map((member) => {
      const record = attendance[member.id];
      const isPastDate = dateKey < dayjs().format('YYYY-MM-DD');
      let status = 'pending';
      if (record?.attended === true) status = 'present';
      else if (record?.status === 'absent_excused') status = 'absent_excused';
      else if (record?.status === 'absent_unexcused' || isPastDate) status = 'absent_unexcused';
      return { ...member, attendanceRecord: record, attendanceStatus: status };
    }),
    [attendance, dateKey, members],
  );

  const dailyCounts = useMemo(() => {
    const counts = { present: 0, excused: 0, unexcused: 0, pending: 0 };
    presentRecords.forEach((member) => {
      if (member.attendanceStatus === 'present') counts.present += 1;
      else if (member.attendanceStatus === 'absent_excused') counts.excused += 1;
      else if (member.attendanceStatus === 'absent_unexcused') counts.unexcused += 1;
      else counts.pending += 1;
    });
    return counts;
  }, [presentRecords]);

  const monthlyStats = useMemo(() => {
    const todayKey = dayjs().format('YYYY-MM-DD');
    let closedMassDays = 0;
    for (
      let date = selectedDate.startOf('month');
      date.format('YYYY-MM-DD') < todayKey && !date.isAfter(selectedDate.endOf('month'));
      date = date.add(1, 'day')
    ) {
      if (date.day() !== 0) closedMassDays += 1;
    }

    const recordsThisMonth = monthAttendance.filter(
      (record) => record.date >= monthStartKey && record.date <= monthEndKey,
    );
    const recordsByMember = new Map();
    recordsThisMonth.forEach((record) => {
      const list = recordsByMember.get(record.member_id) || [];
      list.push(record);
      recordsByMember.set(record.member_id, list);
    });

    return members.map((member) => {
      const records = recordsByMember.get(member.id) || [];
      const presentDates = new Set(
        records.filter((record) => record.attended === true).map((record) => record.date),
      );
      const excusedDates = new Set(
        records.filter((record) => record.status === 'absent_excused').map((record) => record.date),
      );
      const resolvedClosedDates = new Set(
        records
          .filter((record) => (
            record.date < todayKey
            && (record.attended === true || record.status === 'absent_excused')
          ))
          .map((record) => record.date),
      );
      return {
        ...member,
        presentCount: presentDates.size,
        excusedCount: excusedDates.size,
        unexcusedCount: Math.max(0, closedMassDays - resolvedClosedDates.size),
      };
    });
  }, [members, monthAttendance, monthEndKey, monthStartKey, selectedDate]);

  const saveAbsenceStatus = async () => {
    if (!canManageQr || !absenceMember) {
      message.error('Chỉ admin hoặc trưởng nhà mới được cập nhật điểm danh.');
      return;
    }
    if (absenceStatus === 'absent_excused' && !absenceReason.trim()) {
      message.error('Nhập lý do vắng có phép.');
      return;
    }
    setSavingQr(true);
    try {
      const attendanceId = `${encodeURIComponent(houseId)}_${dateKey}_${encodeURIComponent(absenceMember.id)}`;
      await setDoc(doc(db, 'church_attendance', attendanceId), {
        house_id: houseId,
        date: dateKey,
        member_id: absenceMember.id,
        member_name: absenceMember.full_name || absenceMember.holy_name || absenceMember.email || 'Thành viên',
        attended: absenceStatus === 'present',
        status: absenceStatus,
        reason: absenceStatus === 'absent_excused' ? absenceReason.trim() : '',
        recorded_by: auth.currentUser?.uid || '',
        updated_at: serverTimestamp(),
      });
      message.success(absenceStatus === 'present'
        ? 'Đã cập nhật thành có mặt.'
        : absenceStatus === 'absent_excused'
          ? 'Đã lưu vắng có phép và lý do.'
          : 'Đã lưu vắng không phép.');
      setAbsenceMember(null);
      setAbsenceReason('');
    } catch (error) {
      console.error('Không thể lưu trạng thái vắng:', error);
      message.error('Không thể lưu trạng thái vắng. Vui lòng thử lại.');
    } finally {
      setSavingQr(false);
    }
  };

  const createQrSession = useCallback(async ({ silent = false } = {}) => {
    if (savingQr) return;
    if (!canManageQr) {
      if (!silent) message.error('Chỉ admin hoặc trưởng nhà mới được tạo mã QR điểm danh.');
      return;
    }
    if (selectedDate.day() === 0) {
      if (!silent) message.error('Không thể tạo mã điểm danh vào Chủ nhật.');
      return;
    }

    setSavingQr(true);
    try {
      const session = {
        house_id: houseId,
        date: dateKey,
        token: createAttendanceToken(),
        active: true,
        token_version: (qrSession?.token_version || 0) + 1,
        scan_count: qrSession?.scan_count || 0,
        expires_at: Timestamp.fromMillis(Date.now() + QR_VALIDITY_MS),
        created_by: auth.currentUser?.uid || '',
        created_at: serverTimestamp(),
      };
      await setDoc(qrSessionRef, session);
      setQrSession(session);
      setCurrentTime(Date.now());
      setIsQrVisible(true);
      if (!silent) {
        message.success(`Đã tạo mã QR dùng trong 5 phút cho ${weekday}, ngày ${selectedDate.format('DD/MM/YYYY')}.`);
      }
    } catch (error) {
      console.error('Không thể tạo mã QR điểm danh:', error);
      if (!silent) message.error('Không thể tạo mã QR. Vui lòng thử lại.');
    } finally {
      setSavingQr(false);
    }
  }, [canManageQr, dateKey, houseId, qrSession, qrSessionRef, savingQr, selectedDate, weekday]);

  useEffect(() => {
    if (
      !isQrVisible
      || !canManageQr
      || !qrExpired
      || !qrSession?.token
      || savingQr
      || autoRenewedTokenRef.current === qrSession.token
    ) return;

    autoRenewedTokenRef.current = qrSession.token;
    createQrSession({ silent: true });
  }, [canManageQr, createQrSession, isQrVisible, qrExpired, qrSession, savingQr]);

  const openQrCode = () => {
    if (!canManageQr) {
      message.error('Chỉ admin hoặc trưởng nhà mới được hiển thị mã QR điểm danh.');
      return;
    }
    if (qrSession && !qrExpired) setIsQrVisible(true);
    else createQrSession();
  };

  return (
    <div className="church-attendance">
      <div className="church-attendance__heading">
        <div>
          <Text className="church-attendance__eyebrow">ĐIỂM DANH TẠI NHÀ THỜ</Text>
          <Title level={2}>Điểm danh đi lễ</Title>
          <Text type="secondary">Thành viên quét mã QR theo ngày để ghi nhận có mặt từ thứ Hai đến thứ Bảy.</Text>
        </div>
        <BankOutlined className="church-attendance__church-icon" />
      </div>

      <Card bordered={false} className="church-attendance__card">
        <div className="church-attendance__toolbar">
          <div>
            <Text strong>Ngày điểm danh</Text>
            <div className="church-attendance__date-picker">
              <DatePicker
                value={selectedDate}
                format="DD/MM/YYYY"
                allowClear={false}
                disabledDate={(date) => date.day() === 0}
                onChange={(nextDate) => {
                  if (nextDate) {
                    setQrSession(null);
                    setAttendance({});
                    setSelectedDate(nextDate);
                  }
                }}
              />
              <Tag color="green">{weekday}</Tag>
            </div>
          </div>
          <div className="church-attendance__summary">
            <Text type="secondary">Có mặt</Text>
            <strong>{presentCount} / {members.length}</strong>
          </div>
        </div>

        <div className="church-attendance__daily-counts">
          <Tag color="green">{`Có mặt: ${dailyCounts.present}`}</Tag>
          <Tag color="blue">{`Vắng có phép: ${dailyCounts.excused}`}</Tag>
          <Tag color="red">{`Vắng không phép: ${dailyCounts.unexcused}`}</Tag>
          <Tag>{`Chưa điểm danh: ${dailyCounts.pending}`}</Tag>
        </div>

        <Alert
          showIcon
          type="info"
          message="Điểm danh bằng điện thoại"
          description="Admin hoặc trưởng nhà mở mã QR của ngày đã chọn. Người không quét trong ngày đã qua được tính vắng không phép; admin/trưởng nhà có thể cập nhật thành vắng có phép kèm lý do."
          className="church-attendance__notice"
        />

        <div className="church-attendance__qr-action">
          {canManageQr ? (
            <div className="church-attendance__qr-buttons">
              <Button
                type="primary"
                icon={<QrcodeOutlined />}
                loading={savingQr || loading}
                disabled={loading}
                onClick={openQrCode}
              >
                {qrSession && !qrExpired ? 'Hiển thị mã QR cho thành viên quét' : 'Tạo mã QR cho thành viên quét'}
              </Button>
              {isQrVisible && (
                <Button onClick={() => setIsQrVisible(false)}>
                  Ẩn mã QR
                </Button>
              )}
            </div>
          ) : (
            <Text type="secondary">
              Không có nút QR? Tài khoản cần có vai trò admin hoặc Trưởng nhà.
            </Text>
          )}
          <Button
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={fetchAttendance}
          >
            Làm mới điểm danh
          </Button>
        </div>

        {canManageQr && isQrVisible && (
          <Card
            className="church-attendance__qr-card"
            title={`Mã QR điểm danh · ${selectedDate.format('DD/MM/YYYY')}`}
            extra={<Button type="link" onClick={() => setIsQrVisible(false)}>Ẩn</Button>}
          >
            <div className="church-attendance__qr-modal">
              <Text type="secondary">
                Đưa mã QR trên màn hình này cho từng thành viên quét bằng ứng dụng. Mã tự làm mới sau 5 phút.
              </Text>
              {qrSession && (
                <Alert
                  type="success"
                  showIcon
                  message={`Đã quét ${Number(qrSession.scan_count || 0)} lượt`}
                  description={qrSession.last_scanned_member_name
                    ? `Lượt gần nhất: ${qrSession.last_scanned_member_name}.`
                    : 'Đang chờ thành viên quét mã.'}
                />
              )}
              {qrExpired && !savingQr ? (
                <Spin tip="Đang tạo mã QR mới..." />
              ) : (
                <>
                  {qrPayload && <QRCode value={qrPayload} size={256} errorLevel="H" />}
                  <Text strong className="church-attendance__qr-countdown">
                    Mã sẽ đổi sau: {formatTimeRemaining(qrTimeRemaining)}
                  </Text>
                </>
              )}
              <Popconfirm
                title="Tạo mã mới ngay?"
                description="Mã đang hiển thị sẽ mất hiệu lực."
                onConfirm={createQrSession}
                okText="Tạo mã mới"
                cancelText="Hủy"
              >
                <Button icon={<ReloadOutlined />} loading={savingQr}>
                  Làm mới mã ngay
                </Button>
              </Popconfirm>
            </div>
          </Card>
        )}

        {loading ? <div className="church-attendance__loading"><Spin /></div> : (
          <Table
            rowKey="id"
            dataSource={presentRecords}
            pagination={false}
            locale={{ emptyText: <Empty description="Chưa có thành viên trong danh sách." /> }}
            columns={[
              {
                title: 'STT',
                key: 'index',
                width: 72,
                render: (_, __, index) => index + 1,
              },
              {
                title: 'Thành viên',
                key: 'member',
                render: (_, member) => (
                  <div className="church-attendance__member">
                    <strong>{member.full_name || member.holy_name || 'Chưa có tên'}</strong>
                    {member.holy_name && member.full_name && (
                      <Text type="secondary">{member.holy_name}</Text>
                    )}
                  </div>
                ),
              },
              {
                title: 'Trạng thái',
                dataIndex: 'attendanceStatus',
                key: 'attended',
                render: (status, member) => (
                  <div>
                    {status === 'present' && <Tag color="green">Có mặt (QR)</Tag>}
                    {status === 'absent_excused' && <Tag color="blue">Vắng có phép</Tag>}
                    {status === 'absent_unexcused' && <Tag color="red">Vắng không phép</Tag>}
                    {status === 'pending' && <Tag>Chưa điểm danh</Tag>}
                    {member.attendanceRecord?.reason && (
                      <div className="church-attendance__reason">{member.attendanceRecord.reason}</div>
                    )}
                    {canManageQr && (
                      <Button
                        type="link"
                        size="small"
                        onClick={() => {
                          setAbsenceMember(member);
                          setAbsenceStatus(status);
                          setAbsenceReason(member.attendanceRecord?.reason || '');
                        }}
                      >
                        {status === 'pending' ? 'Ghi nhận điểm danh' : 'Chỉnh sửa'}
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}

      </Card>

      <Card
        bordered={false}
        className="church-attendance__stats-card"
        title={`Thống kê đi lễ tháng ${selectedDate.format('MM/YYYY')}`}
      >
        <Table
          rowKey="id"
          size="small"
          dataSource={monthlyStats}
          pagination={false}
          locale={{ emptyText: <Empty description="Chưa có dữ liệu thống kê." /> }}
          columns={[
            {
              title: 'Thành viên',
              key: 'member',
              render: (_, member) => member.full_name || member.holy_name || member.email,
            },
            { title: 'Có mặt', dataIndex: 'presentCount', key: 'presentCount', align: 'center' },
            { title: 'Vắng có phép', dataIndex: 'excusedCount', key: 'excusedCount', align: 'center' },
            { title: 'Vắng không phép', dataIndex: 'unexcusedCount', key: 'unexcusedCount', align: 'center' },
          ]}
        />
        <Text type="secondary">Ngày tương lai và ngày hiện tại chưa kết thúc không bị tính là vắng.</Text>
      </Card>

      <Modal
        title={`Chỉnh sửa điểm danh · ${absenceMember?.full_name || absenceMember?.holy_name || ''}`}
        open={Boolean(absenceMember)}
        onCancel={() => {
          setAbsenceMember(null);
          setAbsenceReason('');
        }}
        onOk={saveAbsenceStatus}
        okText="Lưu điểm danh"
        cancelText="Hủy"
        confirmLoading={savingQr}
      >
        <Select
          value={absenceStatus}
          onChange={setAbsenceStatus}
          options={[
            { value: 'present', label: 'Có mặt' },
            { value: 'absent_unexcused', label: 'Vắng không phép' },
            { value: 'absent_excused', label: 'Vắng có phép' },
          ]}
          style={{ width: '100%', marginBottom: 16 }}
        />
        {absenceStatus === 'absent_excused' && (
          <TextArea
            value={absenceReason}
            onChange={(event) => setAbsenceReason(event.target.value)}
            placeholder="Nhập lý do vắng có phép"
            maxLength={500}
            showCount
            rows={3}
          />
        )}
      </Modal>

    </div>
  );
}
