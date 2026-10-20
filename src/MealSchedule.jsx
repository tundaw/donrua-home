import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  DatePicker,
  Empty,
  Form,
  message,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  DeleteOutlined,
  DownloadOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import './MealSchedule.css';

const { Text, Title } = Typography;

const SHIFT_TYPES = [
  { key: 'shopping', label: 'Đi chợ', shortLabel: 'Đi chợ', color: '#e8f7f4', textColor: '#167c70', slots: 1 },
  { key: 'lunch', label: 'Buổi trưa 11h', shortLabel: 'Buổi trưa', color: '#eef3fb', textColor: '#315a8a', slots: 2 },
  { key: 'dinner', label: 'Buổi tối 18h', shortLabel: 'Buổi tối', color: '#f3effa', textColor: '#7151a1', slots: 2 },
];

const WEEKDAYS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
const CYCLE_LENGTH_DAYS = 14;
const CYCLE_ANCHOR = new Date(2026, 10, 2);
const CYCLE_QUOTA_PER_MEMBER = 4;

function getDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getWeekStart(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = start.getDay();
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
  return start;
}

function getCycleStart(date) {
  const anchor = new Date(CYCLE_ANCHOR);
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (startDate < anchor) return anchor;

  const daysSinceAnchor = Math.floor((startDate - anchor) / 86400000);
  const cycleNumber = Math.floor(daysSinceAnchor / CYCLE_LENGTH_DAYS);
  anchor.setDate(anchor.getDate() + cycleNumber * CYCLE_LENGTH_DAYS);
  return anchor;
}

function getCycleNumber(date) {
  return Math.floor((getCycleStart(date) - CYCLE_ANCHOR) / (CYCLE_LENGTH_DAYS * 86400000));
}

function getMemberQuotas(members) {
  return new Map(members.map((member) => [member.id, CYCLE_QUOTA_PER_MEMBER]));
}

function getFairAssignmentCount(assignments) {
  const assignmentsByWeek = new Map();
  assignments.forEach((assignment) => {
    const weekStart = getDateKey(getWeekStart(new Date(`${assignment.date}T00:00:00`)));
    const weekAssignments = assignmentsByWeek.get(weekStart) || [];
    weekAssignments.push(assignment);
    assignmentsByWeek.set(weekStart, weekAssignments);
  });

  return Array.from(assignmentsByWeek.values()).reduce((total, weekAssignments) => {
    const shoppingCount = weekAssignments.filter((assignment) => assignment.type === 'shopping').length;
    const cookingCount = weekAssignments.length - shoppingCount;
    const isShoppingException = weekAssignments.length === 3 && shoppingCount === 2 && cookingCount === 1;
    const missingMandatoryCooking = shoppingCount === 2 && cookingCount === 0;
    return total + weekAssignments.length - (isShoppingException || missingMandatoryCooking ? 1 : 0);
  }, 0);
}

function formatWeekRange(start, end) {
  const options = { day: '2-digit', month: '2-digit' };
  return `${start.toLocaleDateString('vi-VN', options)} - ${end.toLocaleDateString('vi-VN', options)}/${end.getFullYear()}`;
}

export default function MealSchedule() {
  const currentUser = JSON.parse(localStorage.getItem('currentUser')) || {};
  const houseId = currentUser.house_id || 'DON_RUA';
  const [cycleStart, setCycleStart] = useState(() => getCycleStart(new Date()));
  const [members, setMembers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('standard');
  const [extraCookingWeek, setExtraCookingWeek] = useState(null);
  const [extraCookingMemberId, setExtraCookingMemberId] = useState(null);
  const [mandatoryExtraCooking, setMandatoryExtraCooking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const selectedShiftType = Form.useWatch('type', form);
  const selectedDate = Form.useWatch('date', form);

  const cycleDays = useMemo(
    () => Array.from({ length: CYCLE_LENGTH_DAYS }, (_, index) => {
      const date = new Date(cycleStart);
      date.setDate(date.getDate() + index);
      return date;
    }),
    [cycleStart],
  );
  const cycleWeeks = useMemo(
    () => [cycleDays.slice(0, 7), cycleDays.slice(7, 14)],
    [cycleDays],
  );
  const cycleEnd = cycleDays[CYCLE_LENGTH_DAYS - 1];
  const cycleStartKey = getDateKey(cycleStart);
  const cycleEndKey = getDateKey(cycleEnd);
  const cycleNumber = getCycleNumber(cycleStart);

  const cycleQuotas = useMemo(
    () => getMemberQuotas(members),
    [members],
  );
  const previousCycleQuotas = useMemo(
    () => getMemberQuotas(members),
    [members],
  );

  const fetchSchedule = useCallback(async () => {
    setLoading(true);
    try {
      const [usersSnapshot, schedulesSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('house_id', '==', houseId))),
        getDocs(query(collection(db, 'meal_schedules'), where('house_id', '==', houseId))),
      ]);
      const nextMembers = usersSnapshot.docs.map((memberDoc) => ({ id: memberDoc.id, ...memberDoc.data() }));
      const nextAssignments = schedulesSnapshot.docs.map((scheduleDoc) => ({ id: scheduleDoc.id, ...scheduleDoc.data() }));
      setMembers(nextMembers);
      setAssignments(nextAssignments);
      return { members: nextMembers, assignments: nextAssignments };
    } catch (error) {
      console.error('Không thể tải lịch nấu cơm:', error);
      message.error('Không thể tải lịch nấu cơm. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }, [houseId]);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  const visibleShiftTypes = filter === 'all'
    ? SHIFT_TYPES
    : SHIFT_TYPES.filter((shift) => (filter === 'shopping' ? shift.key === 'shopping' : shift.key !== 'shopping'));

  const getAssignment = (dateKey, shiftKey, slot) => assignments.find(
    (assignment) => assignment.date === dateKey && assignment.type === shiftKey && assignment.slot === slot,
  );

  const getAvailableCookingSlots = (date, shiftKey, schedules = assignments) => {
    const shift = SHIFT_TYPES.find((item) => item.key === shiftKey);
    if (!shift || shift.key === 'shopping') return [];
    const dateKey = getDateKey(date);
    return Array.from({ length: shift.slots }, (_, index) => index + 1)
      .filter((slot) => !schedules.some((assignment) => (
        assignment.date === dateKey
        && assignment.type === shiftKey
        && Number(assignment.slot) === slot
      )));
  };

  const currentCycleAssignments = assignments.filter(
    (assignment) => assignment.date >= cycleStartKey && assignment.date <= cycleEndKey,
  );
  const completedCycleAssignments = assignments.filter(
    (assignment) => assignment.date >= getDateKey(CYCLE_ANCHOR) && assignment.date < cycleStartKey,
  );

  const previousCycleBalance = (memberId) => (
    cycleNumber <= 0
      ? 0
      : (cycleNumber * (previousCycleQuotas.get(memberId) || 0))
        - getFairAssignmentCount(
          completedCycleAssignments.filter((assignment) => assignment.member_id === memberId),
        )
  );

  const registrationLimit = (memberId) => Math.max(
    0,
    (cycleQuotas.get(memberId) || 0) + previousCycleBalance(memberId),
  );

  const currentMemberCount = (memberId) => getFairAssignmentCount(
    currentCycleAssignments.filter((assignment) => assignment.member_id === memberId),
  );

  const getExtraCookingCandidates = (week) => {
    const weekStartKey = getDateKey(week[0]);
    const weekEndKey = getDateKey(week[6]);
    return members.filter((member) => {
      const memberWeekAssignments = assignments.filter((assignment) => (
        assignment.date >= weekStartKey
        && assignment.date <= weekEndKey
        && assignment.member_id === member.id
      ));
      const shoppingCount = memberWeekAssignments.filter((assignment) => assignment.type === 'shopping').length;
      const cookingCount = memberWeekAssignments.filter((assignment) => assignment.type !== 'shopping').length;
      return shoppingCount === 2
        && cookingCount === 0
        && memberWeekAssignments.length === 2
        && registrationLimit(member.id) > currentMemberCount(member.id);
    });
  };

  const openAddModal = (date, shiftKey, slot) => {
    setModalMode('standard');
    setExtraCookingWeek(null);
    setExtraCookingMemberId(null);
    setMandatoryExtraCooking(false);
    const shift = SHIFT_TYPES.find((item) => item.key === shiftKey);
    const dateKey = getDateKey(date);
    const availableSlot = shift && Array.from({ length: shift.slots }, (_, index) => index + 1)
      .find((candidate) => !getAssignment(dateKey, shiftKey, candidate));
    form.setFieldsValue({
      date: dayjs(date),
      type: shiftKey,
      slot: slot && !getAssignment(dateKey, shiftKey, slot) ? slot : availableSlot,
      memberId: undefined,
    });
    setIsModalOpen(true);
  };

  const openExtraCookingModal = (week, memberId = undefined, schedules = assignments, mandatory = false) => {
    const availableChoice = week.flatMap((day) => (
      ['lunch', 'dinner'].flatMap((shiftKey) => getAvailableCookingSlots(day, shiftKey, schedules)
        .map((slot) => ({ date: day, shiftKey, slot })))
    ))[0];
    const date = availableChoice?.date || week[0];
    const shiftKey = availableChoice?.shiftKey || 'lunch';
    setModalMode('extra-cooking');
    setExtraCookingWeek(week);
    setExtraCookingMemberId(memberId || null);
    setMandatoryExtraCooking(mandatory);
    form.setFieldsValue({
      date: dayjs(date),
      type: shiftKey,
      slot: availableChoice?.slot,
      memberId,
    });
    setIsModalOpen(true);
  };

  const addAssignment = async (values) => {
    const dateKey = getDateKey(values.date.toDate());
    const shift = SHIFT_TYPES.find((item) => item.key === values.type);
    const member = members.find((item) => item.id === values.memberId);
    if (!shift || !member) return;
    const isExtraCooking = modalMode === 'extra-cooking';
    if (isExtraCooking && (shift.key === 'shopping' || values.slot < 1 || values.slot > 2)) {
      message.error('Ca bổ sung chỉ dùng cho ca nấu ở vị trí 1 hoặc 2.');
      return;
    }

    const assignmentId = `${encodeURIComponent(houseId)}_${dateKey}_${shift.key}_${values.slot}`;
    const assignmentRef = doc(db, 'meal_schedules', assignmentId);
    setSaving(true);
    try {
      const schedulesSnapshot = await getDocs(query(
        collection(db, 'meal_schedules'),
        where('house_id', '==', houseId),
      ));
      const allAssignments = schedulesSnapshot.docs
        .map((scheduleDoc) => scheduleDoc.data());
      const memberCycleAssignments = allAssignments.filter((assignment) => (
        assignment.date >= cycleStartKey
        && assignment.date <= cycleEndKey
        && assignment.member_id === member.id
      ));
      const weekStart = getWeekStart(values.date.toDate());
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const memberWeekAssignments = allAssignments.filter((assignment) => {
        return assignment.date >= getDateKey(weekStart)
          && assignment.date <= getDateKey(weekEnd)
          && assignment.member_id === member.id;
      });
      const shoppingCount = memberWeekAssignments.filter((assignment) => assignment.type === 'shopping').length;
      const cookingCount = memberWeekAssignments.length - shoppingCount;
      const nextShoppingCount = shoppingCount + (shift.key === 'shopping' ? 1 : 0);
      const nextCookingCount = cookingCount + (shift.key === 'shopping' ? 0 : 1);
      const nextWeekCount = memberWeekAssignments.length + 1;
      const isShoppingException = (
        nextWeekCount === 3
        && nextShoppingCount === 2
        && nextCookingCount === 1
      );

      if (shift.key === 'shopping' && shoppingCount >= 2) {
        throw new Error('SHOPPING_LIMIT');
      }
      if (isExtraCooking && !(
        shoppingCount === 2
        && cookingCount === 0
        && memberWeekAssignments.length === 2
      )) {
        throw new Error('EXTRA_COOKING_NOT_ELIGIBLE');
      }
      if (nextWeekCount > 2 && !(isExtraCooking && isShoppingException)) {
        throw new Error('WEEKLY_LIMIT');
      }
      const completedMemberCount = allAssignments.filter((assignment) => (
        assignment.date >= getDateKey(CYCLE_ANCHOR)
        && assignment.date < cycleStartKey
        && assignment.member_id === member.id
      ));
      const completedFairCount = getFairAssignmentCount(completedMemberCount);
      const carryBalance = cycleNumber <= 0
        ? 0
        : (cycleNumber * (previousCycleQuotas.get(member.id) || 0)) - completedFairCount;
      const memberCycleLimit = Math.max(0, (cycleQuotas.get(member.id) || 0) + carryBalance);
      const nextCycleFairCount = getFairAssignmentCount([
        ...memberCycleAssignments,
        { date: dateKey, type: shift.key },
      ]);
      if (nextCycleFairCount > memberCycleLimit) {
        throw new Error('CYCLE_LIMIT');
      }

      await runTransaction(db, async (transaction) => {
        const slotSnapshot = await transaction.get(assignmentRef);
        if (slotSnapshot.exists()) {
          throw new Error('SLOT_TAKEN');
        }

        transaction.set(assignmentRef, {
          house_id: houseId,
          date: dateKey,
          type: shift.key,
          slot: values.slot,
          member_id: member.id,
          member_name: member.full_name || member.holy_name || member.email,
          created_by: currentUser.uid || '',
          created_at: serverTimestamp(),
        });
      });
      message.success('Đã thêm ca vào lịch.');
      setIsModalOpen(false);
      form.resetFields();
      const mustAddCooking = shift.key === 'shopping'
        && nextShoppingCount === 2
        && nextCookingCount === 0;
      const refreshedSchedule = await fetchSchedule();
      if (mustAddCooking && refreshedSchedule) {
        const weekDays = Array.from({ length: 7 }, (_, index) => {
          const day = new Date(weekStart);
          day.setDate(day.getDate() + index);
          return day;
        });
        openExtraCookingModal(weekDays, member.id, refreshedSchedule.assignments, true);
      } else if (isExtraCooking) {
        setMandatoryExtraCooking(false);
        setExtraCookingMemberId(null);
        setExtraCookingWeek(null);
      }
    } catch (error) {
      if (error.message === 'SLOT_TAKEN') {
        message.error('Ca này vừa được đăng ký. Vui lòng chọn ca khác.');
      } else if (error.message === 'SHOPPING_LIMIT') {
        message.error('Mỗi người chỉ đăng ký tối đa 2 ca đi chợ trong tuần.');
      } else if (error.message === 'WEEKLY_LIMIT') {
        message.error('Mỗi người tối đa 2 ca/tuần. Nếu nhận 2 ca đi chợ, phải đăng ký ca nấu bổ sung bằng nút của tuần.');
      } else if (error.message === 'CYCLE_LIMIT') {
        message.error('Người này đã đủ lượt trong chu kỳ 2 tuần.');
      } else if (error.message === 'EXTRA_COOKING_NOT_ELIGIBLE') {
        message.error('Ca nấu bổ sung chỉ dành cho người đã đăng ký đúng 2 ca đi chợ và chưa có ca nấu trong tuần.');
      } else if (error.code === 'permission-denied') {
        message.error('Firestore chưa cấp quyền ghi lịch nấu (meal_schedules).');
      } else {
        console.error('Không thể lưu lịch nấu:', error);
        message.error('Không thể lưu lịch nấu. Kiểm tra kết nối hoặc quyền Firestore.');
      }
    } finally {
      setSaving(false);
    }
  };

  const removeAssignment = async (assignment) => {
    try {
      await runTransaction(db, async (transaction) => {
        const assignmentRef = doc(db, 'meal_schedules', assignment.id);
        const snapshot = await transaction.get(assignmentRef);
        if (snapshot.exists()) transaction.delete(assignmentRef);
      });
      message.success('Đã xóa phân công.');
      await fetchSchedule();
    } catch (error) {
      console.error('Không thể xóa phân công:', error);
      message.error('Không thể xóa phân công. Vui lòng thử lại.');
    }
  };

  const exportCsv = () => {
    const rows = [['Ngày', 'Ca', 'Người đăng ký']];
    cycleDays.forEach((date) => {
      const dateKey = getDateKey(date);
      SHIFT_TYPES.forEach((shift) => {
        assignments
          .filter((assignment) => assignment.date === dateKey && assignment.type === shift.key)
          .sort((first, second) => first.slot - second.slot)
          .forEach((assignment) => rows.push([dateKey, shift.label, assignment.member_name]));
      });
    });
    const csv = `\uFEFF${rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n')}`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `lich-nau-com-${cycleStartKey}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const selectedShift = SHIFT_TYPES.find((shift) => shift.key === selectedShiftType);
  const availableSlots = selectedShift && selectedDate
    ? modalMode === 'extra-cooking'
      ? getAvailableCookingSlots(selectedDate.toDate(), selectedShift.key)
      : Array.from({ length: selectedShift.slots }, (_, index) => index + 1)
        .filter((slot) => !getAssignment(getDateKey(selectedDate.toDate()), selectedShift.key, slot))
    : [];
  const extraCookingCandidates = extraCookingWeek
    ? getExtraCookingCandidates(extraCookingWeek)
    : [];
  const carryoverBalances = members.map((member) => ({
    member,
    balance: previousCycleBalance(member.id),
    previousCount: getFairAssignmentCount(
      completedCycleAssignments.filter((assignment) => assignment.member_id === member.id),
    ),
    previousQuota: cycleNumber * (previousCycleQuotas.get(member.id) || 0),
  }));
  const membersOwingShifts = carryoverBalances.filter((item) => item.balance > 0);
  const membersWithSurplus = carryoverBalances.filter((item) => item.balance < 0);

  return (
    <section className="meal-schedule">
      <div className="meal-schedule__heading">
        <div>
          <Text className="meal-schedule__eyebrow">NHÀ DON RUA CỦA CHÚNG MÌNH</Text>
          <Title level={2}>Lịch nấu cơm</Title>
          <Text type="secondary">ANH EM NHÀ DONRUA NÂU ĂN HƠI BỊ NGON!</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openAddModal(cycleStart, 'lunch', 1)}>
          Thêm lịch
        </Button>
      </div>

      <div className="meal-schedule__toolbar">
        <div className="meal-schedule__week-navigation">
          <Button
            aria-label="Chu kỳ trước"
            icon={<ArrowLeftOutlined />}
            disabled={cycleNumber <= 0}
            onClick={() => setCycleStart((date) => {
              const previous = new Date(date);
              previous.setDate(previous.getDate() - CYCLE_LENGTH_DAYS);
              return previous;
            })}
          />
          <strong>{formatWeekRange(cycleStart, cycleEnd)}</strong>
          <Button
            aria-label="Chu kỳ sau"
            icon={<ArrowRightOutlined />}
            onClick={() => setCycleStart((date) => {
              const next = new Date(date);
              next.setDate(next.getDate() + CYCLE_LENGTH_DAYS);
              return next;
            })}
          />
          <Button onClick={() => setCycleStart(getCycleStart(new Date()))}>Chu kỳ hiện tại</Button>
        </div>
        <div className="meal-schedule__actions">
          <Select
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'Tất cả' },
              { value: 'cooking', label: 'Nấu cơm' },
              { value: 'shopping', label: 'Đi chợ' },
            ]}
            aria-label="Lọc lịch"
          />
          <Button icon={<DownloadOutlined />} onClick={exportCsv}>Xuất lịch CSV</Button>
        </div>
      </div>

      <Spin spinning={loading}>
        <div className="meal-schedule__calendar-scroll">
          <div className="meal-schedule__calendar">
            {cycleWeeks.map((week, weekIndex) => (
              <section className="meal-schedule__week" key={getDateKey(week[0])}>
                <header className="meal-schedule__week-heading">
                  <div className="meal-schedule__week-label">
                    Tuần {weekIndex + 1}
                    <span>{formatWeekRange(week[0], week[6])}</span>
                  </div>
                  {getExtraCookingCandidates(week).length > 0 && (
                    <Button
                      type="primary"
                      className="meal-schedule__mandatory-cooking"
                      icon={<PlusOutlined />}
                      onClick={() => openExtraCookingModal(week)}
                    >
                      BẮT BUỘC: ĐĂNG KÝ THÊM 1 CA NẤU
                    </Button>
                  )}
                </header>
                <div className="meal-schedule__week-days">
                  {week.map((date) => {
                    const dateKey = getDateKey(date);
                    return (
                      <article className="meal-schedule__day" key={dateKey}>
                        <header className="meal-schedule__day-heading">
                          <Text>{WEEKDAYS[date.getDay()]}</Text>
                          <strong>{date.getDate()}</strong>
                        </header>
                        {visibleShiftTypes.map((shift) => (
                          <div className="meal-schedule__shift" key={shift.key}>
                            <div className="meal-schedule__shift-title">
                              <span>{shift.shortLabel}</span>
                              <Tag bordered={false} style={{ background: shift.color, color: shift.textColor }}>
                                {shift.key === 'shopping' ? 'Chợ' : shift.key === 'lunch' ? '11h' : '18h'}
                              </Tag>
                            </div>
                            {Array.from({
                              length: Math.max(
                                shift.slots,
                                ...assignments
                                  .filter((assignment) => assignment.date === dateKey && assignment.type === shift.key)
                                  .map((assignment) => Number(assignment.slot) || 0),
                              ),
                            }, (_, index) => {
                              const slot = index + 1;
                              const assignment = getAssignment(dateKey, shift.key, slot);
                              return (
                                <div className="meal-schedule__slot" key={slot}>
                                  {assignment ? (
                                    <div className="meal-schedule__assigned">
                                      <span title={assignment.member_name}>{assignment.member_name}</span>
                                      <Popconfirm
                                        title="Xóa phân công này?"
                                        okText="Xóa"
                                        cancelText="Hủy"
                                        onConfirm={() => removeAssignment(assignment)}
                                      >
                                        <Button
                                          aria-label={`Xóa ca ${shift.label}, ${assignment.member_name}`}
                                          type="text"
                                          size="small"
                                          icon={<DeleteOutlined />}
                                        />
                                      </Popconfirm>
                                    </div>
                                  ) : (
                                    <Button
                                      className="meal-schedule__add-slot"
                                      type="dashed"
                                      icon={<PlusOutlined />}
                                      onClick={() => openAddModal(date, shift.key, slot)}
                                    >
                                      Thêm ca
                                    </Button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      </Spin>

      <footer className="meal-schedule__footer">
        <Text type="secondary">Đổi lịch mỗi 2 tuần. Tối đa 2 ca/tuần; ngoại lệ 2 ca đi chợ + 1 ca nấu vẫn tính 2 lượt.</Text>
        <Text type="secondary">{currentCycleAssignments.length} ca đã được phân công trong chu kỳ này</Text>
      </footer>

      <section className="meal-schedule__balance" aria-label="Tổng kết thiếu và dư cộng dồn">
        <Title level={5}>Tổng kết ca cộng dồn từ các chu kỳ trước</Title>
        {cycleNumber <= 0 ? (
          <Text type="secondary">Đăng ký bắt đầu từ 02/11/2026. Hệ thống sẽ tính thiếu/dư từ chu kỳ kế tiếp.</Text>
        ) : carryoverBalances.length === 0 ? (
          <Text type="secondary">Chưa có thành viên để tính chỉ tiêu.</Text>
        ) : (
          <div className="meal-schedule__balance-list">
            {membersOwingShifts.map(({ member, balance, previousQuota, previousCount }) => (
              <div className="meal-schedule__balance-item" key={member.id}>
                <strong>{member.full_name || member.holy_name || member.email}</strong>
                <Text type="danger">Thiếu {balance} lượt  ({previousCount}/{previousQuota} lượt đã hoàn thành) - cần bù kỳ này</Text>
              </div>
            ))}
            {membersWithSurplus.map(({ member, balance, previousQuota, previousCount }) => (
              <div className="meal-schedule__balance-item" key={member.id}>
                <strong>{member.full_name || member.holy_name || member.email}</strong>
                <Text type="secondary">Dư {Math.abs(balance)} lượt cộng dồn ({previousCount}/{previousQuota} lượt công bằng đã hoàn thành) - giảm chỉ tiêu kỳ này</Text>
              </div>
            ))}
            {membersOwingShifts.length === 0 && membersWithSurplus.length === 0 && (
              <Text type="secondary">Mọi người đã đủ lượt theo chỉ tiêu cộng dồn đến hết chu kỳ trước.</Text>
            )}
          </div>
        )}
      </section>

      <Modal
        title={modalMode === 'extra-cooking' ? 'Đăng ký ca nấu bổ sung' : 'Thêm ca nấu cơm'}
        open={isModalOpen}
        closable={!mandatoryExtraCooking}
        maskClosable={!mandatoryExtraCooking}
        onCancel={() => {
          if (mandatoryExtraCooking) {
            message.warning('Bạn cần chọn thêm ca nấu để hoàn tất điều kiện 2 ca đi chợ trong tuần.');
            return;
          }
          setIsModalOpen(false);
        }}
        onOk={() => form.submit()}
        confirmLoading={saving}
        okText="Lưu phân công"
        cancelText="Hủy"
      >
        <Form form={form} layout="vertical" onFinish={addAssignment}>
          {mandatoryExtraCooking && (
            <Text type="danger" style={{ display: 'block', marginBottom: 16 }}>
              Bạn đã đăng ký đủ 2 ca đi chợ trong tuần này. Hãy tự chọn thêm 1 ngày và ca nấu; đây là lượt đăng ký thứ 3 bắt buộc của bạn trong tuần.
            </Text>
          )}
          <Form.Item name="date" label="Ngày" rules={[{ required: true, message: 'Chọn ngày.' }]}>
            <DatePicker
              format="DD/MM/YYYY"
              style={{ width: '100%' }}
              disabledDate={(date) => {
                const dateKey = getDateKey(date.toDate());
                const startKey = extraCookingWeek ? getDateKey(extraCookingWeek[0]) : cycleStartKey;
                const endKey = extraCookingWeek ? getDateKey(extraCookingWeek[6]) : cycleEndKey;
                return dateKey < startKey || dateKey > endKey;
              }}
              onChange={(date) => {
                if (modalMode === 'extra-cooking' && date && selectedShift) {
                  form.setFieldValue('slot', getAvailableCookingSlots(date.toDate(), selectedShift.key)[0]);
                } else {
                  form.setFieldValue('slot', undefined);
                }
              }}
            />
          </Form.Item>
          <Form.Item name="type" label="Ca" rules={[{ required: true, message: 'Chọn ca.' }]}>
            <Select
              options={SHIFT_TYPES
                .filter((shift) => modalMode !== 'extra-cooking' || shift.key !== 'shopping')
                .map((shift) => ({ value: shift.key, label: shift.label }))}
              onChange={(type) => {
                const shift = SHIFT_TYPES.find((item) => item.key === type);
                const date = form.getFieldValue('date')?.toDate();
                if (!shift || !date) return;
                if (modalMode === 'extra-cooking') {
                  form.setFieldValue('slot', getAvailableCookingSlots(date, type)[0]);
                  return;
                }
                const firstFreeSlot = Array.from({ length: shift.slots }, (_, index) => index + 1)
                  .find((slot) => !getAssignment(getDateKey(date), type, slot));
                form.setFieldValue('slot', firstFreeSlot);
              }}
            />
          </Form.Item>
          <Form.Item name="slot" label="Vị trí" rules={[{ required: true, message: 'Chọn vị trí còn trống.' }]}>
            <Select
              options={availableSlots.map((slot) => ({ value: slot, label: `Vị trí ${slot}` }))}
              notFoundContent={modalMode === 'extra-cooking' ? 'Ca này đã kín vị trí 1 và 2.' : undefined}
            />
          </Form.Item>
          <Form.Item name="memberId" label="Thành viên" rules={[{ required: true, message: 'Chọn thành viên.' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Chọn thành viên"
              options={members
                .filter((member) => (
                  modalMode !== 'extra-cooking'
                  || (extraCookingMemberId
                    ? member.id === extraCookingMemberId
                    : extraCookingCandidates.some((candidate) => candidate.id === member.id))
                ))
                .map((member) => ({
                  member,
                  remaining: registrationLimit(member.id) - currentMemberCount(member.id),
                }))
                .sort((first, second) => second.remaining - first.remaining)
                .map(({ member, remaining }) => ({
                  value: member.id,
                  label: `${member.full_name || member.holy_name || member.email} (${Math.max(0, remaining)} ca chu kỳ còn lại)`,
                  disabled: remaining <= 0,
                }))}
              notFoundContent={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có thành viên" />}
            />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}
