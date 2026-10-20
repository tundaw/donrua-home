import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Empty,
  Form,
  Image,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import {
  CalendarOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FileOutlined,
  PlusOutlined,
  UploadOutlined,
  UserOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  addDoc,
  collection,
  deleteField,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
  uploadBytesResumable,
} from 'firebase/storage';
import { auth, db, storage } from './firebase';

const { Text, Title } = Typography;
const ROLE_CAN_EDIT = new Set(['admin', 'administrator', 'truongnha']);
function getFileContentType(fileName, contentType) {
  if (contentType && contentType !== 'application/octet-stream') return contentType;
  const extension = fileName?.split('.').pop()?.toLowerCase();
  const commonTypes = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    txt: 'text/plain',
  };
  return commonTypes[extension] || contentType || '';
}

function getStoredStudyFile(item) {
  const record = item.data();
  const memberId = record.member_id || record.user_id || record.uid || item.id;
  const filePath = record.file_path || record.storage_path || '';
  const fileName = record.file_name
    || record.filename
    || record.fileName
    || record.name
    || filePath.split('/').pop()
    || '';

  return [memberId, {
    id: item.id,
    ...record,
    member_id: memberId,
    file_name: fileName,
    file_url: record.file_url || record.download_url || record.downloadURL || record.url || '',
    file_path: filePath,
  }];
}

function FilePreview({ url, file, fileName, contentType, compact = false, fullFrame = false }) {
  const previewUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : url),
    [file, url],
  );
  useEffect(() => {
    if (!file || !previewUrl) return undefined;
    return () => URL.revokeObjectURL(previewUrl);
  }, [file, previewUrl]);

  const displayedFileName = file?.name || fileName;
  const mimeType = getFileContentType(displayedFileName, file?.type || contentType);
  if (!previewUrl) return null;
  const previewStyle = compact
    ? { width: 280, maxWidth: '100%' }
    : {
      width: '100%',
      padding: fullFrame ? 12 : 0,
      border: fullFrame ? '1px solid #d9e0e7' : undefined,
      borderRadius: fullFrame ? 10 : undefined,
      background: fullFrame ? '#f5f7fa' : undefined,
      boxSizing: 'border-box',
    };
  const fullFrameHeight = fullFrame ? 'calc(100vh - 160px)' : 640;

  return (
    <div className="data-file-preview" style={previewStyle}>
      {mimeType.startsWith('image/') ? (
        <Image
          src={previewUrl}
          alt={displayedFileName || 'Tệp đính kèm'}
          style={{
            display: 'block',
            maxWidth: '100%',
            maxHeight: compact ? 180 : fullFrame ? fullFrameHeight : 640,
            margin: '0 auto',
            objectFit: 'contain',
          }}
        />
      ) : mimeType === 'application/pdf' ? (
        <iframe
          title={displayedFileName || 'Xem trước tệp PDF'}
          src={previewUrl}
          style={{
            width: '100%',
            height: compact ? 240 : fullFrameHeight,
            border: '1px solid #d9e0e7',
            borderRadius: 8,
            display: 'block',
            background: '#fff',
          }}
        />
      ) : mimeType.startsWith('video/') ? (
        <video src={previewUrl} controls style={{ width: '100%', maxHeight: compact ? 200 : 640 }} />
      ) : mimeType.startsWith('audio/') ? (
        <audio src={previewUrl} controls style={{ width: '100%' }} />
      ) : mimeType.startsWith('text/') ? (
        <iframe
          title={displayedFileName || 'Xem trước tệp văn bản'}
          src={previewUrl}
          style={{
            width: '100%',
            height: compact ? 240 : fullFrameHeight,
            border: '1px solid #d9e0e7',
            borderRadius: 8,
            display: 'block',
            background: '#fff',
          }}
        />
      ) : (
        <Alert
          type="info"
          showIcon
          message={displayedFileName || 'Tệp lịch Nhà dòng'}
          description="Định dạng này không hỗ trợ xem trước trực tiếp trên trình duyệt. Bạn có thể mở hoặc tải tệp."
        />
      )}
      <Button
        icon={<DownloadOutlined />}
        href={previewUrl}
        target="_blank"
        rel="noreferrer"
        style={{ marginTop: 8 }}
      >
        {displayedFileName ? `Mở / tải ${displayedFileName}` : 'Mở / tải tệp'}
      </Button>
    </div>
  );
}

function getFirebaseSaveError(error, itemName) {
  switch (error?.code) {
    case 'storage/unauthorized':
      return 'Firebase Storage từ chối tải tệp. Kiểm tra Storage Rules để cho phép tài khoản quản lý tải tệp lên.';
    case 'storage/bucket-not-found':
    case 'storage/no-default-bucket':
      return 'Firebase Storage chưa được bật hoặc chưa có bucket. Bật Storage trong Firebase Console rồi thử lại.';
    case 'storage/quota-exceeded':
      return 'Firebase Storage đã hết dung lượng cho phép.';
    case 'storage/retry-limit-exceeded':
      return 'Tải tệp bị gián đoạn hoặc quá thời gian chờ. Kiểm tra mạng rồi thử lại.';
    case 'storage/unknown':
      return 'Firebase Storage gặp lỗi mạng hoặc máy chủ không xác định. Hãy thử lại.';
    case 'storage/canceled':
      return 'Tải tệp đã bị hủy trước khi hoàn tất.';
    case 'storage/invalid-argument':
      return 'Tệp không hợp lệ. Hãy thử chọn lại tệp.';
    case 'permission-denied':
    case 'firestore/permission-denied':
      return 'Firestore từ chối lưu dữ liệu. Kiểm tra Firestore Rules để cho phép tài khoản quản lý ghi dữ liệu.';
    case 'unauthenticated':
      return 'Phiên đăng nhập đã hết hạn. Đăng nhập lại rồi thử lưu.';
    default:
      return `Không thể lưu ${itemName}${error?.message ? `: ${error.message}` : '. Vui lòng thử lại.'}`;
  }
}

function normalizeRole(role) {
  return String(role || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

export default function DataManagement() {
  const currentUser = useMemo(() => JSON.parse(localStorage.getItem('currentUser')) || {}, []);
  const houseId = currentUser.house_id || 'DON_RUA';
  const canEdit = ROLE_CAN_EDIT.has(normalizeRole(currentUser.role));
  const [pdfRecords, setPdfRecords] = useState([]);
  const [pdfFile, setPdfFile] = useState(null);
  const [savingPdf, setSavingPdf] = useState(false);
  const [houseSchedulePreview, setHouseSchedulePreview] = useState(null);
  const [memberStudyFiles, setMemberStudyFiles] = useState({});
  const [uploadingStudyFileNames, setUploadingStudyFileNames] = useState({});
  const [uploadingStudyMember, setUploadingStudyMember] = useState('');
  const [studyPreview, setStudyPreview] = useState(null);
  const [homeLeaves, setHomeLeaves] = useState([]);
  const [members, setMembers] = useState([]);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [editingLeave, setEditingLeave] = useState(null);
  const [leaveScreenshot, setLeaveScreenshot] = useState(null);
  const [removeExistingScreenshot, setRemoveExistingScreenshot] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leaveForm] = Form.useForm();

  useEffect(() => {
    const unsubscribePdf = onSnapshot(
      query(collection(db, 'house_schedule_pdfs'), where('house_id', '==', houseId)),
      (snapshot) => setPdfRecords(snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      })).sort((first, second) => (
        new Date(second.updated_at?.toDate?.() || second.updated_at || 0).getTime()
          - new Date(first.updated_at?.toDate?.() || first.updated_at || 0).getTime()
      ))),
      (error) => {
        console.error('Không thể tải tài liệu lịch Nhà dòng từ Firestore:', error);
        message.error(`${getFirebaseSaveError(error, 'danh sách lịch Nhà dòng')} (${error?.code || 'unknown'})`);
      },
    );
    const unsubscribeStudyFiles = onSnapshot(
      query(collection(db, 'member_study_files'), where('house_id', '==', houseId)),
      (snapshot) => setMemberStudyFiles(Object.fromEntries(
        snapshot.docs.map(getStoredStudyFile),
      )),
      (error) => {
        console.error('Không thể tải tệp lịch học thành viên:', error);
        message.error('Không thể tải tệp lịch học.');
      },
    );
    const unsubscribeLeave = onSnapshot(
      query(collection(db, 'home_leaves'), where('house_id', '==', houseId)),
      (snapshot) => setHomeLeaves(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
      (error) => {
        console.error('Không thể tải lịch về quê:', error);
        message.error('Không thể tải lịch về quê.');
      },
    );
    const unsubscribeMembers = onSnapshot(
      query(collection(db, 'users'), where('house_id', '==', houseId)),
      (snapshot) => setMembers(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
      (error) => {
        console.error('Không thể tải danh sách thành viên:', error);
        message.error('Không thể tải danh sách thành viên.');
      },
    );
    return () => {
      unsubscribePdf();
      unsubscribeStudyFiles();
      unsubscribeLeave();
      unsubscribeMembers();
    };
  }, [houseId]);

  const uploadPdf = async () => {
    if (!pdfFile) {
      message.error('Vui lòng chọn một tệp.');
      return;
    }
    if (pdfFile.size > 20 * 1024 * 1024) {
      message.error('Tệp không được vượt quá 20 MB.');
      return;
    }

    setSavingPdf(true);
    const storagePath = `house-schedules/${encodeURIComponent(houseId)}/${Date.now()}_${pdfFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    let fileUploaded = false;
    try {
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, pdfFile, {
        contentType: pdfFile.type || 'application/octet-stream',
        customMetadata: {
          fileName: pdfFile.name,
        },
      });
      fileUploaded = true;
      const downloadUrl = await getDownloadURL(storageRef);
      const updatedAt = new Date();
      const fileRecord = {
        house_id: houseId,
        file_name: pdfFile.name,
        content_type: pdfFile.type || 'application/octet-stream',
        storage_path: storagePath,
        download_url: downloadUrl,
        updated_by: auth.currentUser?.uid || '',
        updated_at: updatedAt,
      };
      const savedDocument = await addDoc(collection(db, 'house_schedule_pdfs'), {
        ...fileRecord,
        updated_at: serverTimestamp(),
      });
      const savedRecord = {
        id: savedDocument.id,
        ...fileRecord,
      };
      setPdfRecords((currentRecords) => [savedRecord, ...currentRecords]);
      setPdfFile(null);
      message.success('Đã lưu lịch Nhà dòng.');
    } catch (error) {
      if (fileUploaded) {
        try {
          await deleteObject(ref(storage, storagePath));
        } catch (cleanupError) {
          console.error('Không thể dọn tệp lịch Nhà dòng tải lên chưa lưu:', cleanupError);
        }
      }
      console.error('Không thể cập nhật tài liệu lịch Nhà dòng:', error);
      message.error(`${getFirebaseSaveError(error, 'lịch Nhà dòng')} (${error?.code || 'unknown'})`);
    } finally {
      setSavingPdf(false);
    }
  };

  const uploadMemberStudyFile = async (member, file) => {
    if (!canEdit) {
      message.error('Chỉ admin hoặc trưởng nhà được cập nhật tệp lịch học.');
      return Upload.LIST_IGNORE;
    }
    if (file.size > 20 * 1024 * 1024) {
      message.error('Tệp lịch học không được vượt quá 20 MB.');
      return Upload.LIST_IGNORE;
    }

    const previousFile = memberStudyFiles[member.id];
    const storagePath = `member-study-files/${encodeURIComponent(houseId)}/${member.id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    setUploadingStudyFileNames((currentNames) => ({ ...currentNames, [member.id]: file.name }));
    setUploadingStudyMember(member.id);
    try {
      const storageRef = ref(storage, storagePath);
      const uploadTask = uploadBytesResumable(storageRef, file, {
        contentType: file.type || 'application/octet-stream',
      });
      await new Promise((resolve, reject) => {
        let timeoutTriggered = false;
        const timeout = window.setTimeout(() => {
          timeoutTriggered = true;
          const timeoutError = new Error('Tải tệp vượt quá thời gian chờ.');
          timeoutError.code = 'storage/retry-limit-exceeded';
          reject(timeoutError);
          uploadTask.cancel();
        }, 120000);

        uploadTask.on(
          'state_changed',
          () => {},
          (error) => {
            window.clearTimeout(timeout);
            if (!timeoutTriggered) reject(error);
          },
          () => {
            window.clearTimeout(timeout);
            resolve();
          },
        );
      });
      const downloadUrl = await getDownloadURL(storageRef);
      const savedFile = {
        id: member.id,
        house_id: houseId,
        member_id: member.id,
        member_name: member.full_name || member.holy_name || member.email || 'Thành viên',
        file_name: file.name,
        content_type: file.type || 'application/octet-stream',
        file_path: storagePath,
        file_url: downloadUrl,
        updated_by: auth.currentUser?.uid || '',
        updated_at: serverTimestamp(),
      };
      await setDoc(doc(db, 'member_study_files', member.id), savedFile);
      setMemberStudyFiles((currentFiles) => ({ ...currentFiles, [member.id]: savedFile }));
      if (previousFile?.file_path) {
        try {
          await deleteObject(ref(storage, previousFile.file_path));
        } catch (cleanupError) {
          console.error('Đã lưu tệp lịch học mới nhưng không xóa được tệp cũ:', cleanupError);
          message.warning('Đã lưu tệp mới nhưng chưa xóa được tệp cũ.');
          return false;
        }
      }
      message.success(`Đã cập nhật tệp lịch học của ${member.full_name || member.holy_name || 'thành viên'}.`);
      return false;
    } catch (error) {
      try {
        await deleteObject(ref(storage, storagePath));
      } catch (cleanupError) {
        console.error('Không thể dọn tệp lịch học tải lên chưa lưu:', cleanupError);
      }
      console.error('Không thể lưu tệp lịch học thành viên:', error);
      message.error(`${getFirebaseSaveError(error, 'tệp lịch học')} (${error?.code || 'unknown'})`);
      return Upload.LIST_IGNORE;
    } finally {
      setUploadingStudyFileNames((currentNames) => {
        const nextNames = { ...currentNames };
        delete nextNames[member.id];
        return nextNames;
      });
      setUploadingStudyMember('');
    }
  };

  const saveHomeLeave = async (values) => {
    if (!canEdit) return;
    const existingScreenshotUrl = removeExistingScreenshot ? '' : editingLeave?.screenshot_url || '';
    if (!leaveScreenshot && !existingScreenshotUrl) {
      message.error('Vui lòng tải ảnh chụp màn hình xác nhận đã xin về quê.');
      return;
    }
    const record = {
      house_id: houseId,
      member_id: values.member_id,
      member_name: members.find((member) => member.id === values.member_id)?.full_name
        || members.find((member) => member.id === values.member_id)?.holy_name
        || '',
      departure_date: values.dateRange[0].format('YYYY-MM-DD'),
      return_date: values.dateRange[1].format('YYYY-MM-DD'),
      updated_by: auth.currentUser?.uid || '',
      updated_at: serverTimestamp(),
    };
    setSaving(true);
    let uploadedScreenshotPath = '';
    try {
      const leaveRef = editingLeave
        ? doc(db, 'home_leaves', editingLeave.id)
        : doc(collection(db, 'home_leaves'));
      let screenshotUrl = existingScreenshotUrl;
      if (leaveScreenshot) {
        uploadedScreenshotPath = `home-leave-evidence/${encodeURIComponent(houseId)}/${leaveRef.id}/${Date.now()}_${leaveScreenshot.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const screenshotRef = ref(storage, uploadedScreenshotPath);
        const contentType = leaveScreenshot.type || (
          /\.png$/i.test(leaveScreenshot.name)
            ? 'image/png'
            : /\.webp$/i.test(leaveScreenshot.name)
              ? 'image/webp'
              : 'image/jpeg'
        );
        await uploadBytes(screenshotRef, leaveScreenshot, { contentType });
        screenshotUrl = await getDownloadURL(screenshotRef);
      }
      const savedRecord = {
        ...record,
        screenshot_url: screenshotUrl,
        screenshot_path: leaveScreenshot
          ? uploadedScreenshotPath
          : editingLeave?.screenshot_path || '',
        ...(editingLeave ? { destination: deleteField() } : { created_at: serverTimestamp() }),
      };
      if (editingLeave) await updateDoc(leaveRef, savedRecord);
      else await setDoc(leaveRef, savedRecord);
      if (leaveScreenshot && editingLeave?.screenshot_path) {
        try {
          await deleteObject(ref(storage, editingLeave.screenshot_path));
        } catch (cleanupError) {
          console.error('Không thể xóa ảnh xác nhận cũ:', cleanupError);
        }
      } else if (removeExistingScreenshot && editingLeave?.screenshot_path) {
        try {
          await deleteObject(ref(storage, editingLeave.screenshot_path));
        } catch (cleanupError) {
          console.error('Không thể xóa ảnh xác nhận cũ:', cleanupError);
        }
      }
      message.success('Đã lưu lịch về quê.');
      setLeaveModalOpen(false);
      setEditingLeave(null);
      setLeaveScreenshot(null);
      setRemoveExistingScreenshot(false);
      leaveForm.resetFields();
    } catch (error) {
      if (uploadedScreenshotPath) {
        try {
          await deleteObject(ref(storage, uploadedScreenshotPath));
        } catch (cleanupError) {
          console.error('Không thể dọn ảnh đã tải lên nhưng chưa lưu được lịch:', cleanupError);
        }
      }
      console.error('Không thể lưu lịch về quê:', error);
      message.error(getFirebaseSaveError(error, 'lịch về quê hoặc ảnh xác nhận'));
    } finally {
      setSaving(false);
    }
  };

  const removeRecord = async (collectionName, record, label) => {
    if (!canEdit) {
      message.error('Bạn không có quyền xóa dữ liệu.');
      return;
    }
    try {
      await deleteDoc(doc(db, collectionName, record.id));
      const attachmentPath = collectionName === 'home_leaves'
        ? record.screenshot_path
        : collectionName === 'member_study_files'
          ? record.file_path
          : '';
      if (attachmentPath) {
        try {
          await deleteObject(ref(storage, attachmentPath));
        } catch (storageError) {
          console.error('Đã xóa dữ liệu nhưng không xóa được tệp đính kèm trong Firebase Storage:', storageError);
          message.warning('Đã xóa lịch nhưng chưa xóa được tệp đính kèm trong bộ nhớ.');
          return;
        }
      }
      message.success(`Đã xóa ${label}.`);
    } catch (error) {
      console.error(`Không thể xóa ${label}:`, error);
      message.error(`Không thể xóa ${label}. Vui lòng thử lại.`);
    }
  };

  const openLeaveForm = (leave = null) => {
    setEditingLeave(leave);
    setLeaveScreenshot(null);
    setRemoveExistingScreenshot(false);
    leaveForm.resetFields();
    if (leave) {
      leaveForm.setFieldsValue({
        member_id: leave.member_id,
        dateRange: [dayjs(leave.departure_date), dayjs(leave.return_date)],
      });
    }
    setLeaveModalOpen(true);
  };

  const memberStudyColumns = [
    {
      title: 'Thành viên',
      key: 'member',
      render: (_, member) => (
        <Space>
          <UserOutlined />
          <div>
            <Text strong>{member.full_name || member.holy_name || 'Chưa có tên'}</Text>
            <br />
            <Text type="secondary">{member.email || '—'}</Text>
          </div>
        </Space>
      ),
    },
    {
      title: 'Tên lịch học',
      key: 'study_file',
      render: (_, member) => {
        const studyFileRecord = memberStudyFiles[member.id];
        const displayedFileName = uploadingStudyFileNames[member.id]
          || studyFileRecord?.file_name
          || studyFileRecord?.file_path?.split('/').pop();
        if (!displayedFileName) return <Text type="secondary">Chưa tải tệp lịch học</Text>;

        return (
          <Space size="small" style={{ maxWidth: '100%' }}>
            <Tooltip title={displayedFileName}>
              <Text
                ellipsis
                style={{ maxWidth: 320 }}
              >
                {displayedFileName}
              </Text>
            </Tooltip>
            <Tooltip title="Xem toàn màn hình">
              <Button
                type="text"
                aria-label={`Xem tệp lịch học ${displayedFileName}`}
                icon={<EyeOutlined />}
                onClick={() => setStudyPreview({
                  ...studyFileRecord,
                  member_name: member.full_name || member.holy_name || 'Thành viên',
                })}
              />
            </Tooltip>
          </Space>
        );
      },
    },
    ...(canEdit ? [{
      title: 'Trạng thái',
      key: 'status',
      render: (_, member) => (
        <Space size="small">
          {memberStudyFiles[member.id]?.file_url && (
            <Tag color="green">Đã cập nhật</Tag>
          )}
          <Upload
            accept="*"
            maxCount={1}
            showUploadList={false}
            beforeUpload={(file) => uploadMemberStudyFile(member, file)}
          >
            <Button
              icon={<UploadOutlined />}
              disabled={Boolean(uploadingStudyMember)}
            >
              {memberStudyFiles[member.id]?.file_url ? 'Thay tệp' : 'Tải tệp lên'}
            </Button>
          </Upload>
        </Space>
      ),
    },
    ] : []),
  ];

  const leaveColumns = [
    { title: 'Thành viên', dataIndex: 'member_name', key: 'member_name' },
    {
      title: 'Thời gian',
      key: 'date_range',
      render: (_, item) => `${dayjs(item.departure_date).format('DD/MM/YYYY')} - ${dayjs(item.return_date).format('DD/MM/YYYY')}`,
    },
    {
      title: 'Ảnh xác nhận đã xin về quê',
      dataIndex: 'screenshot_url',
      key: 'screenshot',
      render: (url) => url
        ? <Image src={url} alt="Ảnh chụp màn hình xác nhận xin về quê" width={80} />
        : <Tag color="orange">Chưa có ảnh</Tag>,
    },
    ...(canEdit ? [{
      title: 'Thao tác',
      key: 'actions',
      render: (_, item) => (
        <Space>
          <Button aria-label="Sửa lịch về quê" icon={<EditOutlined />} onClick={() => openLeaveForm(item)} />
          <Popconfirm title="Xóa lịch về quê này?" onConfirm={() => removeRecord('home_leaves', item, 'lịch về quê')}>
            <Button danger aria-label="Xóa lịch về quê" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    }] : []),
  ];

  const pdfTab = (
    <Card bordered={false}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div>
          <Title level={4}><FileOutlined /> Lịch Nhà dòng</Title>
          <Text type="secondary">Thêm tệp lịch để mọi thành viên trong nhà cùng xem.</Text>
        </div>
        {pdfRecords.length > 0 ? (
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            {pdfRecords.map((record) => (
              <div
                key={record.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 12,
                  padding: '12px 16px',
                  border: '1px solid #d9e0e7',
                  borderRadius: 10,
                  background: '#fff',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Text strong style={{ display: 'block', overflowWrap: 'anywhere' }}>
                    {record.file_name || 'Lịch Nhà dòng'}
                  </Text>
                  <Text type="secondary">
                    {record.updated_at
                      ? `Cập nhật lúc ${dayjs(record.updated_at?.toDate
                        ? record.updated_at.toDate()
                        : record.updated_at).format('DD/MM/YYYY HH:mm')}`
                      : 'Tài liệu đã được thêm.'}
                  </Text>
                </div>
                <Space>
                  <Tooltip title="Xem toàn màn hình">
                    <Button
                      aria-label={`Xem lịch Nhà dòng ${record.file_name || ''}`}
                      icon={<EyeOutlined />}
                      onClick={() => setHouseSchedulePreview(record)}
                    />
                  </Tooltip>
                  <Button
                    icon={<DownloadOutlined />}
                    href={record.download_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Mở / tải
                  </Button>
                </Space>
              </div>
            ))}
          </Space>
        ) : !pdfFile && <Empty description="Chưa có tệp lịch Nhà dòng." />}
        {pdfFile && (
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Text strong>Xem trước lịch: {pdfFile.name}</Text>
            <FilePreview file={pdfFile} fullFrame />
          </Space>
        )}
        <Space wrap>
          <Upload
            maxCount={1}
            beforeUpload={(file) => {
              setPdfFile(file);
              return false;
            }}
            onRemove={() => setPdfFile(null)}
            fileList={pdfFile ? [{ uid: pdfFile.uid, name: pdfFile.name, status: 'done' }] : []}
          >
            <Button icon={<UploadOutlined />}>Chọn tệp</Button>
          </Upload>
          <Button type="primary" icon={<UploadOutlined />} loading={savingPdf} disabled={!pdfFile} onClick={uploadPdf}>
            Lưu lịch
          </Button>
        </Space>
        <Text type="secondary">Hỗ trợ mọi định dạng tệp, tối đa 20 MB.</Text>
      </Space>
    </Card>
  );

  const studyTab = (
    <Card bordered={false}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Title level={4} style={{ margin: 0 }}>Lịch học theo thành viên</Title>
        <Text type="secondary">
          Mỗi thành viên có một tệp lịch học riêng. Hỗ trợ mọi định dạng tệp, tối đa 20 MB.
        </Text>
        <Table
          rowKey="id"
          columns={memberStudyColumns}
          dataSource={[...members].sort((first, second) => (
            (first.full_name || first.holy_name || '').localeCompare(
              second.full_name || second.holy_name || '',
              'vi',
            )
          ))}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: <Empty description="Chưa có thành viên trong danh sách." /> }}
        />
      </Space>
    </Card>
  );

  const leaveTab = (
    <Card bordered={false}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={() => openLeaveForm()}>Thêm lịch về quê</Button>}
        <Table
          rowKey="id"
          columns={leaveColumns}
          dataSource={[...homeLeaves].sort((first, second) => first.departure_date.localeCompare(second.departure_date))}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: <Empty description="Chưa có lịch về quê." /> }}
        />
      </Space>
    </Card>
  );

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Text type="secondary">Tài liệu và lịch sinh hoạt</Text>
        <Title level={2} style={{ marginTop: 4 }}><CalendarOutlined /> Dữ liệu</Title>
      </div>
      {!canEdit && <Alert showIcon type="info" message="Mọi thành viên trong nhà có thể cập nhật lịch Nhà dòng. Các mục lịch học và lịch về quê chỉ admin hoặc trưởng nhà được chỉnh sửa." style={{ marginBottom: 16 }} />}
      <Tabs
        items={[
          { key: 'house', label: 'Lịch Nhà dòng', children: pdfTab },
          { key: 'study', label: 'Lịch học', children: studyTab },
          { key: 'leave', label: 'Lịch về quê', children: leaveTab },
        ]}
      />

      <Modal
        title={houseSchedulePreview?.file_name || 'Xem lịch Nhà dòng'}
        open={Boolean(houseSchedulePreview)}
        onCancel={() => setHouseSchedulePreview(null)}
        footer={houseSchedulePreview ? (
          <Space>
            <Button onClick={() => setHouseSchedulePreview(null)}>Đóng</Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              href={houseSchedulePreview.download_url}
              target="_blank"
              rel="noreferrer"
            >
              Mở / tải tệp
            </Button>
          </Space>
        ) : null}
        width="100vw"
        style={{ top: 0, maxWidth: '100vw', paddingBottom: 0 }}
        styles={{
          body: {
            height: 'calc(100vh - 110px)',
            overflow: 'auto',
            padding: 12,
          },
        }}
        destroyOnHidden
      >
        {houseSchedulePreview && (
          <FilePreview
            url={houseSchedulePreview.download_url}
            fileName={houseSchedulePreview.file_name}
            contentType={houseSchedulePreview.content_type}
            fullFrame
          />
        )}
      </Modal>

      <Modal
        title={studyPreview
          ? `Lịch học · ${studyPreview.member_name} · ${studyPreview.file_name}`
          : 'Xem lịch học'}
        open={Boolean(studyPreview)}
        onCancel={() => setStudyPreview(null)}
        footer={studyPreview ? (
          <Space>
            <Button onClick={() => setStudyPreview(null)}>Đóng</Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              href={studyPreview.file_url}
              target="_blank"
              rel="noreferrer"
            >
              Mở / tải tệp
            </Button>
          </Space>
        ) : null}
        width="100vw"
        style={{ top: 0, maxWidth: '100vw', paddingBottom: 0 }}
        styles={{
          body: {
            height: 'calc(100vh - 110px)',
            overflow: 'auto',
            padding: 12,
          },
        }}
        destroyOnHidden
      >
        {studyPreview && (
          <FilePreview
            url={studyPreview.file_url}
            file={studyPreview.file}
            fileName={studyPreview.file_name}
            contentType={studyPreview.content_type}
            fullFrame
          />
        )}
      </Modal>

      <Modal
        title={editingLeave ? 'Sửa lịch về quê' : 'Thêm lịch về quê'}
        open={leaveModalOpen}
        onCancel={() => {
          setLeaveModalOpen(false);
          setEditingLeave(null);
          setLeaveScreenshot(null);
          setRemoveExistingScreenshot(false);
        }}
        onOk={() => leaveForm.submit()}
        okText="Lưu lịch"
        cancelText="Hủy"
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={leaveForm} layout="vertical" onFinish={saveHomeLeave}>
          <Form.Item name="member_id" label="Thành viên" rules={[{ required: true, message: 'Chọn thành viên.' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={members.map((member) => ({
                value: member.id,
                label: member.full_name || member.holy_name || member.email || 'Thành viên',
              }))}
            />
          </Form.Item>
          <Form.Item name="dateRange" label="Ngày đi – ngày về" rules={[{ required: true, message: 'Chọn ngày đi và ngày về.' }]}>
            <DatePicker.RangePicker
              format="DD/MM/YYYY"
              style={{ width: '100%' }}
              disabledDate={(date, info) => (
                info?.from ? date.isBefore(info.from, 'day') : false
              )}
            />
          </Form.Item>
          <Form.Item label="Ảnh chụp màn hình đã xin về quê" required>
            {editingLeave?.screenshot_url && !removeExistingScreenshot && !leaveScreenshot && (
              <Space direction="vertical" style={{ marginBottom: 12 }}>
                <Image
                  src={editingLeave.screenshot_url}
                  alt="Ảnh chụp màn hình xác nhận xin về quê"
                  width={180}
                />
                <Button danger size="small" onClick={() => setRemoveExistingScreenshot(true)}>
                  Thay ảnh xác nhận
                </Button>
              </Space>
            )}
            <Upload
              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              maxCount={1}
              beforeUpload={(file) => {
                const validImage = ['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
                  || /\.(png|jpe?g|webp)$/i.test(file.name);
                if (!validImage) {
                  message.error('Chỉ hỗ trợ ảnh PNG, JPG hoặc WEBP.');
                  return Upload.LIST_IGNORE;
                }
                if (file.size > 10 * 1024 * 1024) {
                  message.error('Ảnh không được vượt quá 10 MB.');
                  return Upload.LIST_IGNORE;
                }
                setLeaveScreenshot(file);
                return false;
              }}
              onRemove={() => setLeaveScreenshot(null)}
              fileList={leaveScreenshot
                ? [{ uid: leaveScreenshot.uid, name: leaveScreenshot.name, status: 'done' }]
                : []}
            >
              <Button icon={<UploadOutlined />}>
                {editingLeave?.screenshot_url ? 'Chọn ảnh thay thế' : 'Tải ảnh chụp màn hình'}
              </Button>
            </Upload>
            <Text type="secondary">Ảnh xác nhận là bắt buộc. Hỗ trợ PNG, JPG, WEBP, tối đa 10 MB.</Text>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
