import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SettingOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  runTransaction,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import './CleaningSchedule.css';

const { Text, Title } = Typography;
const { TextArea } = Input;
const CLEANING_SCHEDULE_START = dayjs('2026-11-02');
const CLEANING_SCHEDULE_START_MONTH = CLEANING_SCHEDULE_START.startOf('month');

const SAMPLE_POSITIONS = [
  {
    name: 'Phòng vệ sinh 1',
    capacity: 1,
    description: '- Cọ rửa bồn cầu bằng Vim; lau sạch sàn và tường.\n- Vệ sinh khu vực thoát nước, bồn rửa mặt; dùng xà phòng và dọn rác.',
  },
  {
    name: 'Bếp',
    capacity: 4,
    description: '- Dọn khu vực nấu ăn; rửa và sắp xếp bát đũa, nồi chảo.\n- Quét rác, bụi dưới bàn ghế và lau bàn ăn.\n- Giặt khăn lau bàn, đem phơi.\n- Lau nhà sau cùng, lau hai lượt rồi giặt sạch giẻ lau.',
  },
  {
    name: 'Phòng ngủ (học) 1',
    capacity: 1,
    description: '- Dọn khu vực bàn học, bỏ rác, lau bụi và quét dưới bàn.\n- Dọn gầm bàn, gầm giường và lối đi; giữ phòng gọn gàng.',
  },
  {
    name: 'Sảnh dưới',
    capacity: 1,
    description: '- Xếp xe gọn gàng.\n- Quét và lau sảnh; đem túi rác ra ngoài.\n- Sắp xếp lại vật dụng.',
  },
  {
    name: 'Phòng vệ sinh 2',
    capacity: 1,
    description: '- Cọ rửa bồn cầu bằng Vim; lau sạch sàn và tường.\n- Vệ sinh khu vực thoát nước, bồn rửa mặt; dùng xà phòng và dọn rác.',
  },
  {
    name: 'Phòng đồ',
    capacity: 1,
    description: '- Treo quần áo lên móc, xếp gọn đồ trên kệ và khăn.\n- Bỏ rác; không để vali hoặc cặp dưới sàn.\n- Quét và lau nhà.',
  },
  {
    name: 'Phòng ngủ 2',
    capacity: 1,
    description: '- Dọn khu vực bàn học, bỏ rác, lau bụi và quét dưới bàn.\n- Dọn gầm bàn, gầm giường và lối đi; giữ phòng gọn gàng.',
  },
  {
    name: 'Sảnh trên',
    capacity: 1,
    description: '- Gom quần áo bẩn vào thau, đổ rác đúng nơi.\n- Xếp gọn vật dụng trên sảnh vào góc khô ráo, tránh mưa.',
  },
];

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }
  return result;
}

export default function CleaningSchedule() {
  const currentUser = JSON.parse(localStorage.getItem('currentUser')) || {};
  const houseId = currentUser.house_id || 'DON_RUA';
  const [month, setMonth] = useState(() => {
    const currentMonth = dayjs().startOf('month');
    return currentMonth.isBefore(CLEANING_SCHEDULE_START_MONTH)
      ? CLEANING_SCHEDULE_START_MONTH
      : currentMonth;
  });
  const [members, setMembers] = useState([]);
  const [positions, setPositions] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [lockedMonths, setLockedMonths] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingPosition, setEditingPosition] = useState(null);
  const [addingToPosition, setAddingToPosition] = useState(null);
  const [editingAssignment, setEditingAssignment] = useState(null);
  const [selectedMemberId, setSelectedMemberId] = useState(undefined);
  const [form] = Form.useForm();
  const monthKey = month.format('YYYY-MM');
  const previousMonthKey = month.subtract(1, 'month').format('YYYY-MM');
  const monthLockId = `${encodeURIComponent(houseId)}_${monthKey}`;
  const monthLockRef = useMemo(
    () => doc(db, 'cleaning_schedule_locks', monthLockId),
    [monthLockId],
  );
  const isMonthLocked = Boolean(lockedMonths[monthKey]);

  const fetchSchedule = useCallback(async () => {
    setLoading(true);
    try {
      const [usersSnapshot, positionsSnapshot, assignmentsSnapshot, lockSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('house_id', '==', houseId))),
        getDocs(query(collection(db, 'cleaning_positions'), where('house_id', '==', houseId))),
        getDocs(query(collection(db, 'cleaning_schedules'), where('house_id', '==', houseId))),
        getDoc(monthLockRef),
      ]);
      setMembers(usersSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      setPositions(positionsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      setAssignments(assignmentsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      setLockedMonths((previous) => {
        if (lockSnapshot.exists()) return { ...previous, [monthKey]: lockSnapshot.data() };
        const next = { ...previous };
        delete next[monthKey];
        return next;
      });
    } catch (error) {
      console.error('Không thể tải lịch trực vệ sinh:', error);
      message.error('Không thể tải lịch trực vệ sinh. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }, [houseId, monthKey, monthLockRef]);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  const activePositions = useMemo(
    () => positions.filter((position) => position.active !== false)
      .sort((first, second) => (first.name || '').localeCompare(second.name || '', 'vi')),
    [positions],
  );
  const monthAssignments = assignments.filter((assignment) => assignment.month_key === monthKey);
  const previousMonthMemberIds = useMemo(
    () => new Set(assignments
      .filter((assignment) => (
        month.isAfter(CLEANING_SCHEDULE_START_MONTH, 'month')
        && assignment.month_key === previousMonthKey
      ))
      .map((assignment) => assignment.member_id)),
    [assignments, month, previousMonthKey],
  );
  const assignedThisMonthMemberIds = useMemo(
    () => new Set(monthAssignments.map((assignment) => assignment.member_id)),
    [monthAssignments],
  );
  const availableMembers = members.filter((member) => (
    !assignedThisMonthMemberIds.has(member.id)
    && !previousMonthMemberIds.has(member.id)
  ));

  const handleSavePosition = async (values) => {
    const positionData = {
      house_id: houseId,
      name: values.name.trim(),
      capacity: values.capacity,
      description: values.description?.trim() || '',
      active: true,
    };
    try {
      if (editingPosition) {
        await updateDoc(doc(db, 'cleaning_positions', editingPosition.id), positionData);
        message.success('Đã cập nhật vị trí trực.');
      } else {
        await addDoc(collection(db, 'cleaning_positions'), {
          ...positionData,
          created_at: serverTimestamp(),
        });
        message.success('Đã thêm vị trí trực.');
      }
      form.resetFields();
      setEditingPosition(null);
      await fetchSchedule();
    } catch (error) {
      console.error('Không thể lưu vị trí trực vệ sinh:', error);
      message.error('Không thể lưu vị trí trực. Vui lòng thử lại.');
    }
  };

  const openPositionEditor = (position = null) => {
    setEditingPosition(position);
    form.resetFields();
    form.setFieldsValue(position
      ? { name: position.name, capacity: position.capacity, description: position.description || '' }
      : { capacity: 1 });
  };

  const closeSettings = () => {
    setSettingsOpen(false);
    setEditingPosition(null);
    form.resetFields();
  };

  const handleDeletePosition = async (position) => {
    try {
      await updateDoc(doc(db, 'cleaning_positions', position.id), { active: false });
      message.success('Đã ngừng sử dụng vị trí trực.');
      if (editingPosition?.id === position.id) {
        setEditingPosition(null);
        form.resetFields();
      }
      await fetchSchedule();
    } catch (error) {
      console.error('Không thể ngừng vị trí trực vệ sinh:', error);
      message.error('Không thể ngừng vị trí trực. Vui lòng thử lại.');
    }
  };

  const handleAddSamplePositions = async () => {
    setSaving(true);
    try {
      const batch = writeBatch(db);
      SAMPLE_POSITIONS.forEach((position) => {
        const positionRef = doc(collection(db, 'cleaning_positions'));
        batch.set(positionRef, {
          ...position,
          house_id: houseId,
          active: true,
          created_at: serverTimestamp(),
        });
      });
      await batch.commit();
      message.success('Đã thêm 8 khu vực và mô tả công việc theo mẫu.');
      await fetchSchedule();
    } catch (error) {
      console.error('Không thể thêm vị trí mẫu:', error);
      message.error('Không thể thêm vị trí mẫu. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  const handleRandomSchedule = async () => {
    if (isMonthLocked) {
      message.error('Lịch tháng này đã được lưu và khóa, không thể thay đổi.');
      return;
    }
    if (activePositions.length === 0) {
      message.warning('Hãy thêm ít nhất một vị trí trực trước khi xếp lịch.');
      return;
    }
    const requestedCount = activePositions.reduce(
      (total, position) => total + Number(position.capacity || 0),
      0,
    );
    if (!Number.isInteger(requestedCount) || requestedCount < 1) {
      message.error('Số người cần trực tại mỗi vị trí phải lớn hơn 0.');
      return;
    }
    if (requestedCount > members.length) {
      message.error(`Tổng số chỗ trực (${requestedCount}) vượt quá số thành viên (${members.length}).`);
      return;
    }

    const eligibleMembers = shuffle(members.filter((member) => !previousMonthMemberIds.has(member.id)));
    if (eligibleMembers.length < requestedCount) {
      message.error(
        `Tháng trước có ${previousMonthMemberIds.size} người đã trực; hiện không đủ người để xếp ${requestedCount} vị trí mà không trùng tháng liền trước.`,
        6,
      );
      return;
    }

    const selectedMembers = eligibleMembers.slice(0, requestedCount);
    const newAssignments = [];
    let memberIndex = 0;
    activePositions.forEach((position) => {
      for (let slot = 1; slot <= Number(position.capacity); slot += 1) {
        const member = selectedMembers[memberIndex];
        memberIndex += 1;
        newAssignments.push({
          house_id: houseId,
          month_key: monthKey,
          position_id: position.id,
          position_name: position.name,
          position_description: position.description || '',
          slot,
          member_id: member.id,
          member_name: member.full_name || member.holy_name || member.email || 'Thành viên',
          created_by: currentUser.uid || '',
          created_at: serverTimestamp(),
        });
      }
    });

    setSaving(true);
    try {
      await runTransaction(db, async (transaction) => {
        const lockSnapshot = await transaction.get(monthLockRef);
        if (lockSnapshot.exists()) throw new Error('SCHEDULE_LOCKED');
        assignments
          .filter((assignment) => assignment.month_key === monthKey)
          .forEach((assignment) => transaction.delete(doc(db, 'cleaning_schedules', assignment.id)));
        newAssignments.forEach((assignment) => {
          const assignmentId = [
            encodeURIComponent(houseId),
            monthKey,
            encodeURIComponent(assignment.position_id),
            assignment.slot,
          ].join('_');
          transaction.set(doc(db, 'cleaning_schedules', assignmentId), assignment);
        });
      });
      message.success(`Đã xếp ngẫu nhiên ${requestedCount} người cho tháng ${month.format('MM/YYYY')}.`);
      await fetchSchedule();
    } catch (error) {
      if (error.message === 'SCHEDULE_LOCKED') {
        message.error('Lịch tháng này đã được lưu và khóa, không thể thay đổi.');
        await fetchSchedule();
        return;
      }
      console.error('Không thể xếp lịch trực vệ sinh:', error);
      message.error('Không thể xếp lịch trực. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddMemberToPosition = async () => {
    if (isMonthLocked) {
      message.error('Lịch tháng này đã được lưu và khóa, không thể thay đổi.');
      return;
    }
    if (!addingToPosition || !selectedMemberId) {
      message.error('Chọn thành viên cần phân công.');
      return;
    }

    const positionAssignments = monthAssignments.filter(
      (assignment) => assignment.position_id === addingToPosition.id,
    );
    if (positionAssignments.length >= Number(addingToPosition.capacity)) {
      message.error('Vị trí này đã đủ số người.');
      return;
    }
    if (assignedThisMonthMemberIds.has(selectedMemberId)) {
      message.error('Thành viên này đã được phân công trong tháng.');
      return;
    }
    if (previousMonthMemberIds.has(selectedMemberId)) {
      message.error('Thành viên này đã trực tháng trước, vui lòng chọn người khác.');
      return;
    }

    const member = members.find((item) => item.id === selectedMemberId);
    if (!member) {
      message.error('Không tìm thấy thành viên được chọn. Vui lòng tải lại trang.');
      return;
    }
    const usedSlots = new Set(positionAssignments.map((assignment) => Number(assignment.slot)));
    let slot = 1;
    while (usedSlots.has(slot) && slot <= Number(addingToPosition.capacity)) slot += 1;
    if (slot > Number(addingToPosition.capacity)) {
      message.error('Vị trí này đã đủ số người.');
      return;
    }

    const assignmentId = [
      encodeURIComponent(houseId),
      monthKey,
      encodeURIComponent(addingToPosition.id),
      slot,
    ].join('_');
    setSaving(true);
    try {
      await runTransaction(db, async (transaction) => {
        const [lockSnapshot, assignmentSnapshot] = await Promise.all([
          transaction.get(monthLockRef),
          transaction.get(doc(db, 'cleaning_schedules', assignmentId)),
        ]);
        if (lockSnapshot.exists()) throw new Error('SCHEDULE_LOCKED');
        if (assignmentSnapshot.exists()) throw new Error('SLOT_TAKEN');
        transaction.set(doc(db, 'cleaning_schedules', assignmentId), {
          house_id: houseId,
          month_key: monthKey,
          position_id: addingToPosition.id,
          position_name: addingToPosition.name,
          position_description: addingToPosition.description || '',
          slot,
          member_id: member.id,
          member_name: member.full_name || member.holy_name || member.email || 'Thành viên',
          created_by: currentUser.uid || '',
          created_at: serverTimestamp(),
        });
      });
      message.success(`Đã phân công ${member.full_name || member.holy_name || member.email} vào ${addingToPosition.name}.`);
      setAddingToPosition(null);
      setSelectedMemberId(undefined);
      await fetchSchedule();
    } catch (error) {
      if (error.message === 'SCHEDULE_LOCKED') {
        message.error('Lịch tháng này đã được lưu và khóa, không thể thay đổi.');
        closeMemberModal();
        await fetchSchedule();
        return;
      }
      if (error.message === 'SLOT_TAKEN') {
        message.error('Chỗ này vừa được người khác phân công. Vui lòng tải lại lịch.');
        await fetchSchedule();
        return;
      }
      console.error('Không thể thêm thành viên vào vị trí trực:', error);
      message.error('Không thể thêm thành viên. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateAssignedMember = async () => {
    if (isMonthLocked) {
      message.error('Lịch tháng này đã được lưu và khóa, không thể thay đổi.');
      return;
    }
    if (!editingAssignment || !selectedMemberId) {
      message.error('Chọn thành viên cần phân công.');
      return;
    }
    if (selectedMemberId !== editingAssignment.member_id) {
      if (assignedThisMonthMemberIds.has(selectedMemberId)) {
        message.error('Thành viên này đã được phân công ở vị trí khác trong tháng.');
        return;
      }
      if (previousMonthMemberIds.has(selectedMemberId)) {
        message.error('Thành viên này đã trực tháng trước, vui lòng chọn người khác.');
        return;
      }
    }

    const member = members.find((item) => item.id === selectedMemberId);
    if (!member) {
      message.error('Không tìm thấy thành viên được chọn. Vui lòng tải lại trang.');
      return;
    }

    setSaving(true);
    try {
      await runTransaction(db, async (transaction) => {
        const lockSnapshot = await transaction.get(monthLockRef);
        if (lockSnapshot.exists()) throw new Error('SCHEDULE_LOCKED');
        transaction.update(doc(db, 'cleaning_schedules', editingAssignment.id), {
          member_id: member.id,
          member_name: member.full_name || member.holy_name || member.email || 'Thành viên',
          updated_by: currentUser.uid || '',
          updated_at: serverTimestamp(),
        });
      });
      message.success(`Đã đổi người trực thành ${member.full_name || member.holy_name || member.email}.`);
      setAddingToPosition(null);
      setEditingAssignment(null);
      setSelectedMemberId(undefined);
      await fetchSchedule();
    } catch (error) {
      if (error.message === 'SCHEDULE_LOCKED') {
        message.error('Lịch tháng này đã được lưu và khóa, không thể thay đổi.');
        closeMemberModal();
        await fetchSchedule();
        return;
      }
      console.error('Không thể đổi thành viên trực vệ sinh:', error);
      message.error('Không thể đổi người trực. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAssignedMember = async () => {
    if (!editingAssignment) return;
    if (isMonthLocked) {
      message.error('Lịch tháng này đã được lưu và khóa, không thể thay đổi.');
      return;
    }

    setSaving(true);
    try {
      await runTransaction(db, async (transaction) => {
        const lockSnapshot = await transaction.get(monthLockRef);
        if (lockSnapshot.exists()) throw new Error('SCHEDULE_LOCKED');
        transaction.delete(doc(db, 'cleaning_schedules', editingAssignment.id));
      });
      message.success(`Đã xóa ${editingAssignment.member_name} khỏi lịch trực.`);
      closeMemberModal();
      await fetchSchedule();
    } catch (error) {
      if (error.message === 'SCHEDULE_LOCKED') {
        message.error('Lịch tháng này đã được lưu và khóa, không thể thay đổi.');
        closeMemberModal();
        await fetchSchedule();
        return;
      }
      console.error('Không thể xóa người khỏi lịch trực vệ sinh:', error);
      message.error('Không thể xóa phân công. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  const handleLockSchedule = async () => {
    if (isMonthLocked) {
      message.info('Lịch tháng này đã được khóa.');
      return;
    }
    const missingPositions = activePositions.filter((position) => (
      monthAssignments.filter((assignment) => assignment.position_id === position.id).length
      !== Number(position.capacity)
    ));
    if (missingPositions.length > 0) {
      message.error(`Chưa đủ người tại: ${missingPositions.map((position) => position.name).join(', ')}.`);
      return;
    }
    if (new Set(monthAssignments.map((assignment) => assignment.member_id)).size !== monthAssignments.length) {
      message.error('Có thành viên bị phân công trùng trong tháng. Hãy sửa lịch trước khi lưu.');
      return;
    }

    setSaving(true);
    try {
      await runTransaction(db, async (transaction) => {
        const lockSnapshot = await transaction.get(monthLockRef);
        if (lockSnapshot.exists()) throw new Error('SCHEDULE_LOCKED');
        transaction.set(monthLockRef, {
          house_id: houseId,
          month_key: monthKey,
          assignment_count: monthAssignments.length,
          positions: activePositions.map((position) => ({
            id: position.id,
            name: position.name,
            capacity: position.capacity,
            description: position.description || '',
            active: true,
          })),
          locked_by: currentUser.uid || '',
          locked_at: serverTimestamp(),
        });
      });
      message.success(`Đã lưu và khóa lịch tháng ${month.format('MM/YYYY')}.`);
      await fetchSchedule();
    } catch (error) {
      if (error.message === 'SCHEDULE_LOCKED') {
        message.error('Lịch tháng này đã được lưu và khóa.');
        await fetchSchedule();
        return;
      }
      console.error('Không thể lưu và khóa lịch trực vệ sinh:', error);
      message.error('Không thể lưu lịch. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  const openAddMember = (position) => {
    setAddingToPosition(position);
    setEditingAssignment(null);
    setSelectedMemberId(undefined);
  };

  const openEditMember = (position, assignment) => {
    setAddingToPosition(position);
    setEditingAssignment(assignment);
    setSelectedMemberId(assignment.member_id);
  };

  const closeMemberModal = () => {
    setAddingToPosition(null);
    setEditingAssignment(null);
    setSelectedMemberId(undefined);
  };

  const editAvailableMembers = editingAssignment
    ? members.filter((member) => (
      member.id === editingAssignment.member_id
      || (!assignedThisMonthMemberIds.has(member.id) && !previousMonthMemberIds.has(member.id))
    ))
    : availableMembers;

  const schedulePositions = isMonthLocked && Array.isArray(lockedMonths[monthKey]?.positions)
    ? lockedMonths[monthKey].positions
    : activePositions;

  const positionList = useMemo(() => {
    const listedIds = new Set(schedulePositions.map((position) => position.id));
    const archivedPositions = monthAssignments
      .filter((assignment) => !listedIds.has(assignment.position_id))
      .reduce((result, assignment) => {
        if (!result.some((position) => position.id === assignment.position_id)) {
          result.push({
            id: assignment.position_id,
            name: assignment.position_name || 'Vị trí đã ngừng',
            description: assignment.position_description || '',
            active: false,
          });
        }
        return result;
      }, []);
    return [...schedulePositions, ...archivedPositions];
  }, [schedulePositions, monthAssignments]);

  return (
    <div className="cleaning-schedule">
      <div className="cleaning-schedule__heading">
        <div>
          <Text className="cleaning-schedule__eyebrow">PHÂN CÔNG HÀNG THÁNG</Text>
          <Title level={2}>Lịch trực vệ sinh</Title>
          <Text type="secondary">
            Bắt đầu từ 02/11/2026. Mỗi tháng đổi lượt; người đã trực tháng trước sẽ được ưu tiên nghỉ lượt này.
          </Text>
        </div>
        <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)} disabled={isMonthLocked}>
          Quản lý vị trí
        </Button>
      </div>

      <Card bordered={false} className="cleaning-schedule__card">
        <div className="cleaning-schedule__toolbar">
          <div className="cleaning-schedule__month">
            <Button
              aria-label="Tháng trước"
              icon={<ArrowLeftOutlined />}
              disabled={!month.isAfter(CLEANING_SCHEDULE_START_MONTH, 'month')}
              onClick={() => setMonth((value) => (
                value.subtract(1, 'month').isBefore(CLEANING_SCHEDULE_START_MONTH, 'month')
                  ? CLEANING_SCHEDULE_START_MONTH
                  : value.subtract(1, 'month')
              ))}
            />
            <Title level={3}>{month.format('[Tháng] M, YYYY')}</Title>
            <Button
              aria-label="Tháng sau"
              icon={<ArrowRightOutlined />}
              onClick={() => setMonth((value) => value.add(1, 'month'))}
            />
          </div>
          <div className="cleaning-schedule__actions">
            <Popconfirm
              title="Xếp lại lịch tháng này?"
              description="Lịch hiện tại của tháng này sẽ được thay thế."
              onConfirm={handleRandomSchedule}
              okText="Xếp lịch"
              cancelText="Hủy"
            >
              <Button
                icon={<SyncOutlined />}
                loading={saving}
                disabled={isMonthLocked || activePositions.length === 0 || members.length === 0}
              >
                Xếp lịch ngẫu nhiên
              </Button>
            </Popconfirm>
            <Popconfirm
              title="Lưu và khóa toàn bộ lịch tháng này?"
              description="Sau khi khóa, không thể xếp lại hoặc đổi người trực trong tháng này."
              onConfirm={handleLockSchedule}
              okText="Lưu và khóa"
              cancelText="Hủy"
            >
              <Button
                type="primary"
                loading={saving}
                disabled={isMonthLocked || activePositions.length === 0 || monthAssignments.length === 0}
              >
                Lưu
              </Button>
            </Popconfirm>
          </div>
        </div>

        {loading ? <div className="cleaning-schedule__loading"><Spin /></div> : (
          <>
            {isMonthLocked && (
              <Alert
                type="success"
                showIcon
                message={`Lịch tháng ${month.format('MM/YYYY')} đã được lưu và khóa.`}
                description="Không thể thêm người, đổi người, chỉnh vị trí hoặc xếp lại lịch của tháng này."
                className="cleaning-schedule__notice"
              />
            )}
            {activePositions.length > 0 && monthAssignments.length === 0 && (
              <Alert
                type="info"
                showIcon
                message="Tháng này chưa có lịch trực."
                description="Chọn “Xếp lịch ngẫu nhiên” để phân công theo số người cần tại mỗi vị trí."
                className="cleaning-schedule__notice"
              />
            )}
            {positionList.length === 0 ? (
              <Empty description="Chưa có vị trí trực. Hãy thêm vị trí để bắt đầu.">
                <Button
                  icon={<PlusOutlined />}
                  loading={saving}
                  onClick={handleAddSamplePositions}
                >
                  Thêm 8 khu vực theo mẫu
                </Button>
              </Empty>
            ) : (
              <Table
                className="cleaning-schedule__table"
                dataSource={positionList.map((position) => {
                  const positionAssignments = monthAssignments
                    .filter((assignment) => assignment.position_id === position.id)
                    .sort((first, second) => Number(first.slot) - Number(second.slot));
                  return {
                    ...position,
                    key: position.id,
                    positionAssignments,
                    assignedCount: positionAssignments.length,
                  };
                })}
                pagination={false}
                columns={[
                  {
                    title: 'Tên',
                    key: 'members',
                    render: (_, record) => (
                      <div className="cleaning-schedule__assigned-members">
                        {record.positionAssignments.length ? record.positionAssignments.map((assignment) => (
                          <div className="cleaning-schedule__assigned-member" key={assignment.id}>
                            <span>{assignment.member_name}</span>
                            {record.active && !isMonthLocked && (
                              <Button
                                type="text"
                                size="small"
                                aria-label={`Đổi người trực ${assignment.member_name} tại ${record.name}`}
                                icon={<EditOutlined />}
                                onClick={() => openEditMember(record, assignment)}
                              />
                            )}
                          </div>
                        )) : <Text type="secondary">Chưa xếp lịch</Text>}
                        {record.active && !isMonthLocked && record.assignedCount < Number(record.capacity) && (
                          <Button
                            type="link"
                            size="small"
                            icon={<PlusOutlined />}
                            disabled={availableMembers.length === 0}
                            onClick={() => openAddMember(record)}
                          >
                            Thêm người
                          </Button>
                        )}
                      </div>
                    ),
                  },
                  {
                    title: 'Khu vực',
                    dataIndex: 'name',
                    key: 'name',
                    render: (name, record) => (
                      <div>
                        <strong>{name}</strong>
                        {!record.active && <Tag className="cleaning-schedule__archived-tag">Đã ngừng</Tag>}
                        <div><Text type="secondary">{`Cần ${record.capacity || record.assignedCount || 0} người`}</Text></div>
                      </div>
                    ),
                  },
                  {
                    title: 'Mô tả công việc',
                    dataIndex: 'description',
                    key: 'description',
                    render: (description) => description
                      ? <span className="cleaning-schedule__description">{description}</span>
                      : <Text type="secondary">Chưa có mô tả</Text>,
                  },
                ]}
              />
            )}
          </>
        )}
      </Card>

      <Modal
        title={addingToPosition
          ? `${editingAssignment ? 'Đổi người trực' : 'Thêm người'} · ${addingToPosition.name}`
          : 'Thêm người'}
        open={Boolean(addingToPosition)}
        onCancel={closeMemberModal}
        onOk={editingAssignment ? handleUpdateAssignedMember : handleAddMemberToPosition}
        okText={editingAssignment ? 'Lưu thay đổi' : 'Phân công'}
        cancelText="Hủy"
        confirmLoading={saving}
        okButtonProps={{ disabled: !selectedMemberId }}
        footer={(_, { OkBtn, CancelBtn }) => (
          <div className="cleaning-schedule__member-modal-footer">
            {editingAssignment && !isMonthLocked ? (
              <Popconfirm
                title="Xóa người này khỏi vị trí trực?"
                description="Vị trí sẽ còn trống cho đến khi bạn thêm người khác."
                onConfirm={handleDeleteAssignedMember}
                okText="Xóa"
                cancelText="Hủy"
              >
                <Button danger icon={<DeleteOutlined />} loading={saving}>
                  Xóa phân công
                </Button>
              </Popconfirm>
            ) : <span />}
            <div>
              <CancelBtn />
              <OkBtn />
            </div>
          </div>
        )}
      >
        {addingToPosition && (
          <>
            <Text type="secondary">
              {editingAssignment
                ? 'Chọn người thay thế. Người đã được phân công ở vị trí khác trong tháng hoặc trực tháng trước không thể chọn.'
                : `Còn ${Math.max(0, Number(addingToPosition.capacity) - monthAssignments.filter(
                  (assignment) => assignment.position_id === addingToPosition.id,
                ).length)} chỗ trống. Thành viên đã trực tháng này hoặc tháng trước không thể chọn.`}
            </Text>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Chọn thành viên"
              value={selectedMemberId}
              onChange={setSelectedMemberId}
              options={editAvailableMembers.map((member) => {
                const label = member.full_name || member.holy_name || member.email || 'Thành viên';
                return { value: member.id, label };
              })}
              notFoundContent="Không còn thành viên đủ điều kiện"
              style={{ width: '100%', marginTop: 16 }}
            />
          </>
        )}
      </Modal>

      <Modal
        title="Quản lý vị trí trực"
        open={settingsOpen}
        onCancel={closeSettings}
        footer={null}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSavePosition}>
          <Form.Item
            name="name"
            label="Tên vị trí"
            rules={[{ required: true, whitespace: true, message: 'Nhập tên vị trí trực.' }]}
          >
            <Input maxLength={80} placeholder="Ví dụ: Nhà bếp, Nhà vệ sinh tầng 1" />
          </Form.Item>
          <Form.Item
            name="capacity"
            label="Số người cần tại vị trí"
            rules={[{ required: true, message: 'Nhập số người cần trực.' }]}
          >
            <InputNumber min={1} max={members.length || 1} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="description" label="Mô tả công việc">
            <TextArea
              rows={4}
              maxLength={1000}
              showCount
              placeholder="Nhập các công việc cần làm tại khu vực này."
            />
          </Form.Item>
          <div className="cleaning-schedule__form-actions">
            {editingPosition ? (
              <Button onClick={() => openPositionEditor(null)}>Hủy chỉnh sửa</Button>
            ) : <span />}
            <Button type="primary" htmlType="submit" icon={editingPosition ? undefined : <PlusOutlined />}>
              {editingPosition ? 'Lưu thay đổi' : 'Thêm vị trí'}
            </Button>
          </div>
        </Form>

        <div className="cleaning-schedule__settings-list">
          {positions.map((position) => (
            <div className="cleaning-schedule__setting-row" key={position.id}>
              <div>
                <strong>{position.name}</strong>
                <Text type="secondary">{` · ${position.capacity} người`}</Text>
                {position.active === false && <Tag>Đã ngừng</Tag>}
              </div>
              <div>
                {position.active !== false && (
                  <>
                    <Button type="link" onClick={() => openPositionEditor(position)}>Sửa</Button>
                    <Popconfirm
                      title="Ngừng sử dụng vị trí này?"
                      description="Lịch sử các tháng đã xếp vẫn được giữ lại."
                      onConfirm={() => handleDeletePosition(position)}
                      okText="Ngừng"
                      cancelText="Hủy"
                    >
                      <Button danger type="text" aria-label={`Ngừng ${position.name}`} icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
