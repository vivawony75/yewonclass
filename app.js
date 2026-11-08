/**
 * 내 금쪽이들 - 학교 출결 및 상담 관리 웹앱
 * - 관리자 계정 설정 (아이디/비밀번호 변경 시 안티그래비티를 통해 ADMIN_CREDENTIALS 수정)
 * - 주간 출석부 (월~금, 휴업일 체크, A1/A2 입력, 6~10열 자동 계산 및 색상 경고)
 * - 상담관리 및 상담카드 모달 (10줄 스크롤, 3줄 상담내용 스크롤)
 * - 관리자 메뉴 (학생 추가/저장/수정/삭제, 상담내역 Word 다운로드, 출결관리 6~10열 필터링)
 * - Firebase Firestore 실시간 연동 + LocalStorage 자동 백업
 */

// ============================================================================
// 1. 관리자 및 교사 로그인 정보 (관리자 비밀번호 분실 시 안티그래비티로 수정 요청)
// ============================================================================
const ADMIN_CREDENTIALS = {
  id: '예성원',
  aliasIds: ['admin', '관리자', 'administrator', 'master', 'root', 'yewon'],
  pw: 'admin4441#',
  fallbackPws: [
    'admin4441#'
  ]
};

// 모든 교사 공통 로그인 비밀번호
const TEACHER_DEFAULT_PASSWORD = 'yewon4441#';

// 대한민국 기본 공휴일 (월-일 또는 연-월-일) - 연속 5일 미인정결석 계산 시 주말·휴업일과 함께 자동 연결
const KOREAN_PUBLIC_HOLIDAYS_MMDD = new Set([
  '01-01', // 신정
  '03-01', // 삼일절
  '05-05', // 어린이날
  '06-06', // 현충일
  '08-15', // 광복절
  '10-03', // 개천절
  '10-09', // 한글날
  '12-25'  // 성탄절
]);

const STORAGE_KEY = 'MY_PRECIOUS_KIDS_STATE_V1';
const FIREBASE_CONFIG_KEY = 'MY_PRECIOUS_KIDS_FIREBASE_CONFIG';
const SESSION_AUTH_KEY = 'MY_PRECIOUS_KIDS_LOGGED_IN';
const SESSION_CURRENT_ACCOUNT_KEY = 'MY_PRECIOUS_KIDS_CURRENT_ACCOUNT';

// ============================================================================
// [학생기본자료] 기본 제공 항목 스키마 (중항목 및 소항목 초기 설정 - 현재 항목 그대로 유지)
// ============================================================================
const DEFAULT_BASIC_INFO_SCHEMA = [
  {
    id: 'familyType',
    name: '가정형태',
    icon: '🏠',
    type: 'checkbox',
    hasEtc: true,
    etcPlaceholder: '기타 가정형태를 직접 입력하세요...',
    items: ['양부모', '한부모(아버지)', '한부모(어머니)', '조부모', '다문화']
  },
  {
    id: 'economicStatus',
    name: '경제적 형편',
    icon: '💰',
    type: 'radio',
    hasEtc: false,
    etcPlaceholder: '',
    defaultValue: '중',
    items: ['상', '중상', '중', '중하', '하']
  },
  {
    id: 'careerHope',
    name: '진로희망',
    icon: '🎯',
    type: 'checkbox',
    hasEtc: true,
    etcPlaceholder: '기타 진로희망을 직접 기록하세요...',
    items: ['대학진학', '취업', '진로탐색']
  },
  {
    id: 'attitudePositive',
    name: '생활태도 [긍정·모범]',
    icon: '🌱',
    subHeader: '[긍정·모범 태도]',
    color: '#2b8a3e',
    type: 'checkbox',
    hasEtc: true,
    etcPlaceholder: '기타 긍정 태도를 직접 입력하세요...',
    items: ['선행', '리더십', '봉사', '배려']
  },
  {
    id: 'problemBehavior',
    name: '생활태도 [관심·지도]',
    icon: '🌱',
    subHeader: '[관심·지도 태도]',
    color: '#c92a2a',
    type: 'checkbox',
    hasEtc: true,
    etcPlaceholder: '기타 관심/지도 태도를 직접 입력하세요...',
    items: ['흡연', '음주', '나태함', '학교폭력', '교권침해', '지도불응', '자해', '자살생각', '가출']
  }
];

// 기본 Firebase 설정 (설정값을 여기에 직접 입력해두면 브라우저를 처음 열어도 모든 기기에서 자동 연동됩니다)
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyB-Gj6tjxKJsEgyapI7kCa85NBJ6P2n5E8",
  authDomain: "yewonclass.firebaseapp.com",
  databaseURL: "https://yewonclass-default-rtdb.firebaseio.com",
  projectId: "yewonclass",
  storageBucket: "yewonclass.firebasestorage.app",
  messagingSenderId: "839399649835",
  appId: "1:839399649835:web:d5bec5682e8db1f300b06e",
  measurementId: "G-7EW548J01X"
};

// ============================================================================
// 2. 초기 샘플 데이터 및 계정별 독립 데이터 관리 (각 계정마다 새로운 양식 제공)
// ============================================================================
function createBlankAccountData(teacherName = '') {
  return {
    students: [
      { id: 'stu-' + Date.now() + '-1', studentNo: '10101', name: '', isEditing: true },
      { id: 'stu-' + Date.now() + '-2', studentNo: '10102', name: '', isEditing: true },
      { id: 'stu-' + Date.now() + '-3', studentNo: '10103', name: '', isEditing: true }
    ],
    attendance: {},
    holidays: {},
    holidayReasons: {},
    basicInfos: {},
    basicInfoHistory: {},
    counselings: []
  };
}

function getInitialState() {
  const adminAccountData = {
    students: [
      { id: 'stu-1', studentNo: '10101', name: '김금쪽', isEditing: false },
      { id: 'stu-2', studentNo: '10102', name: '이사랑', isEditing: false },
      { id: 'stu-3', studentNo: '10103', name: '박희망', isEditing: false },
      { id: 'stu-4', studentNo: '10104', name: '최햇살', isEditing: false },
      { id: 'stu-5', studentNo: '10105', name: '정바름', isEditing: false }
    ],
    attendance: {},
    holidays: {},
    holidayReasons: {},
    basicInfos: {},
    basicInfoHistory: {},
    counselings: []
  };

  const sampleTeacher1Data = {
    students: [
      { id: 'stu-tch1-1', studentNo: '10101', name: '강하늘', isEditing: false },
      { id: 'stu-tch1-2', studentNo: '10102', name: '윤바다', isEditing: false },
      { id: 'stu-tch1-3', studentNo: '10103', name: '송샛별', isEditing: false }
    ],
    attendance: {},
    holidays: {},
    holidayReasons: {},
    basicInfos: {},
    basicInfoHistory: {},
    counselings: []
  };

  const sampleTeacher2Data = {
    students: [
      { id: 'stu-tch2-1', studentNo: '10201', name: '조아라', isEditing: false },
      { id: 'stu-tch2-2', studentNo: '10202', name: '한결음', isEditing: false }
    ],
    attendance: {},
    holidays: {},
    holidayReasons: {},
    basicInfos: {},
    basicInfoHistory: {},
    counselings: []
  };

  return {
    teachers: [
      { id: 'tch-1', name: '김선생', pw: TEACHER_DEFAULT_PASSWORD, note: '1학년 1반', isEditing: false },
      { id: 'tch-2', name: '이선생', pw: TEACHER_DEFAULT_PASSWORD, note: '1학년 2반', isEditing: false }
    ],
    accountsData: {
      'admin': adminAccountData,
      'tch-1': sampleTeacher1Data,
      'tch-2': sampleTeacher2Data
    },
    supportLinks: [],
    basicInfoSchema: JSON.parse(JSON.stringify(DEFAULT_BASIC_INFO_SCHEMA)),
    // Active pointers (현재 활성 계정의 데이터를 가리켜 기존 코드 100% 호환)
    students: adminAccountData.students,
    attendance: adminAccountData.attendance,
    holidays: adminAccountData.holidays,
    holidayReasons: adminAccountData.holidayReasons,
    basicInfos: adminAccountData.basicInfos,
    basicInfoHistory: adminAccountData.basicInfoHistory,
    counselings: adminAccountData.counselings
  };
}

let currentActiveAccountId = 'admin';

// 출결 입력값 자동 정규화:
// - 대소문자 (a, b -> A, B)
// - 한글 키보드 오타 (ㅁ -> A, ㅠ -> B)
// - 숫자 입력 편의 (1 -> A, 2 -> B)
// - 기존 레거시 코드 (A1 -> A, A2/B1 -> B)
function normalizeAttendanceValue(raw) {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim();
  if (!s) return '';
  const upper = s.toUpperCase();

  // A 계열 (미인정결석)
  if (upper === 'A' || upper === 'A1' || upper === '1' || s === 'ㅁ') {
    return 'A';
  }
  // B 계열 (기타결석)
  if (upper === 'B' || upper === 'A2' || upper === 'B1' || upper === '2' || s === 'ㅠ') {
    return 'B';
  }

  // 앞글자나 부분 매칭 (한글 자모 등)
  if (upper.startsWith('A') || s.startsWith('ㅁ')) return 'A';
  if (upper.startsWith('B') || s.startsWith('ㅠ')) return 'B';

  return s;
}

function getCurrentAccount() {
  try {
    const raw = sessionStorage.getItem(SESSION_CURRENT_ACCOUNT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function syncCurrentToAccountData() {
  if (!state.accountsData) state.accountsData = {};
  state.accountsData[currentActiveAccountId] = {
    students: state.students || [],
    attendance: state.attendance || {},
    holidays: state.holidays || {},
    holidayReasons: state.holidayReasons || {},
    basicInfos: state.basicInfos || {},
    basicInfoHistory: state.basicInfoHistory || {},
    counselings: state.counselings || []
  };
}

function applyActiveAccount(accountId) {
  syncCurrentToAccountData();

  if (!state.accountsData) state.accountsData = {};
  if (!state.accountsData[accountId]) {
    const tch = (state.teachers || []).find(t => t.id === accountId);
    state.accountsData[accountId] = createBlankAccountData(tch ? tch.name : '');
  }

  currentActiveAccountId = accountId;
  const acc = state.accountsData[accountId];

  state.students = acc.students || [];
  state.attendance = acc.attendance || {};
  state.holidays = acc.holidays || {};
  state.holidayReasons = acc.holidayReasons || {};
  state.basicInfos = acc.basicInfos || {};
  state.basicInfoHistory = acc.basicInfoHistory || {};
  state.counselings = acc.counselings || [];
}

// 연속 5일 자동 상담 판별 헬퍼 (완전 폐지 및 기존 잔여 데이터 일괄 삭제용)
function isStreak5MilestoneCounseling(c) {
  if (!c) return false;
  if (c.isMilestone === 'streak5') return true;
  if (typeof c.id === 'string' && c.id.startsWith('milestone-streak5-')) return true;
  if (c.milestoneType === '미인정결석 연속 5일') return true;
  if (typeof c.milestoneType === 'string' && c.milestoneType.includes('연속 5일')) return true;
  return false;
}

// 로컬 및 계정 전체에서 미인정결석 연속 5일 상담 행 완전 삭제
function purgeStreak5CounselingRecords() {
  let changed = false;
  if (Array.isArray(state && state.counselings)) {
    const beforeLen = state.counselings.length;
    state.counselings = state.counselings.filter(c => !isStreak5MilestoneCounseling(c));
    if (state.counselings.length !== beforeLen) changed = true;
  }
  if (state && state.accountsData && typeof state.accountsData === 'object') {
    Object.keys(state.accountsData).forEach(accId => {
      const acc = state.accountsData[accId];
      if (acc && Array.isArray(acc.counselings)) {
        const bLen = acc.counselings.length;
        acc.counselings = acc.counselings.filter(c => !isStreak5MilestoneCounseling(c));
        if (acc.counselings.length !== bLen) changed = true;
      }
    });
  }
  return changed;
}

let state = loadStateFromLocal();
if (purgeStreak5CounselingRecords()) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {}
}
let currentMonday = getMondayOfDate(new Date());
let activeDetailWordGenerator = null; // 상세 모달의 Word 다운로드 콜백
let firestoreDb = null;
let isSyncingFromCloud = false;

function loadStateFromLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getInitialState();
    const parsed = JSON.parse(raw);

    const initial = getInitialState();
    const teachers = Array.isArray(parsed.teachers) && parsed.teachers.length > 0
      ? parsed.teachers
      : initial.teachers;
    const accountsData = parsed.accountsData || {};

    // 1) 기존 단일 state 구조에서 accountsData['admin']으로의 자동 마이그레이션
    if (!accountsData['admin']) {
      const att = parsed.attendance || {};
      Object.keys(att).forEach(stuId => {
        Object.keys(att[stuId] || {}).forEach(ymd => {
          att[stuId][ymd] = normalizeAttendanceValue(att[stuId][ymd]);
        });
      });

      accountsData['admin'] = {
        students: Array.isArray(parsed.students) && parsed.students.length > 0 ? parsed.students : initial.accountsData['admin'].students,
        attendance: att,
        holidays: parsed.holidays || {},
        holidayReasons: parsed.holidayReasons || {},
        basicInfos: parsed.basicInfos || {},
        basicInfoHistory: parsed.basicInfoHistory || {},
        counselings: Array.isArray(parsed.counselings) ? parsed.counselings : []
      };
    } else {
      // 기존 accountsData['admin']의 출석 기록이 비어있고 parsed.attendance에 남아있으면 복원
      if (
        (!accountsData['admin'].attendance || Object.keys(accountsData['admin'].attendance).length === 0) &&
        parsed.attendance && Object.keys(parsed.attendance).length > 0
      ) {
        accountsData['admin'].attendance = parsed.attendance;
      }
    }

    // accountsData 내 모든 계정의 attendance 값을 A/B로 정규화
    Object.keys(accountsData).forEach(accId => {
      const acc = accountsData[accId];
      if (acc && acc.attendance) {
        Object.keys(acc.attendance).forEach(stuId => {
          Object.keys(acc.attendance[stuId] || {}).forEach(ymd => {
            const norm = normalizeAttendanceValue(acc.attendance[stuId][ymd]);
            if (norm === 'A' || norm === 'B') {
              acc.attendance[stuId][ymd] = norm;
            } else if (!norm) {
              delete acc.attendance[stuId][ymd];
            }
          });
        });
      }
    });

    // 2) 등록된 각 교사별 accountsData가 없으면 기본 양식 생성 및 기본 비밀번호(yewon4441#) 동기화
    teachers.forEach(tch => {
      if (!tch.pw || tch.pw === '1234') {
        tch.pw = TEACHER_DEFAULT_PASSWORD;
      }
      if (!accountsData[tch.id]) {
        accountsData[tch.id] = initial.accountsData[tch.id] || createBlankAccountData(tch.name);
      }
    });

    // accountsData 내 모든 계정의 counselings에서 연속 5일 잔여 행 일괄 제거
    Object.keys(accountsData).forEach(accId => {
      const acc = accountsData[accId];
      if (acc && Array.isArray(acc.counselings)) {
        acc.counselings = acc.counselings.filter(c => !isStreak5MilestoneCounseling(c));
      }
    });

    const currentAcc = getCurrentAccount();
    const targetAccountId = (currentAcc && accountsData[currentAcc.id]) ? currentAcc.id : 'admin';
    currentActiveAccountId = targetAccountId;

    const activeAcc = accountsData[targetAccountId];
    const initialCounselings = (activeAcc.counselings || []).filter(c => !isStreak5MilestoneCounseling(c));

    const basicInfoSchema = (Array.isArray(parsed.basicInfoSchema) && parsed.basicInfoSchema.length > 0)
      ? parsed.basicInfoSchema
      : JSON.parse(JSON.stringify(DEFAULT_BASIC_INFO_SCHEMA));

    return {
      teachers,
      accountsData,
      supportLinks: Array.isArray(parsed.supportLinks) ? parsed.supportLinks : [],
      basicInfoSchema,
      students: activeAcc.students || [],
      attendance: activeAcc.attendance || {},
      holidays: activeAcc.holidays || {},
      holidayReasons: activeAcc.holidayReasons || {},
      basicInfos: activeAcc.basicInfos || {},
      basicInfoHistory: activeAcc.basicInfoHistory || {},
      counselings: initialCounselings
    };
  } catch (e) {
    console.warn('로컬 데이터 로드 실패, 기본값 사용:', e);
    return getInitialState();
  }
}

function normalizeUrl(url) {
  if (!url) return '#';
  let clean = String(url).trim();
  if (!clean) return '#';
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    clean = 'https://' + clean;
  }
  return clean;
}

async function saveState() {
  syncCurrentToAccountData();
  // 편집 상태 플래그를 제외한 순수 데이터 저장
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (firestoreDb && !isSyncingFromCloud) {
    try {
      const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      await setDoc(doc(firestoreDb, 'appData', 'mainState'), {
        teachers: state.teachers || [],
        accountsData: state.accountsData || {},
        basicInfoSchema: state.basicInfoSchema || DEFAULT_BASIC_INFO_SCHEMA,
        // 탑레벨 필드도 함께 저장하여 구버전 호환 및 onSnapshot 시 데이터 소실 완전 방지
        students: state.students || [],
        attendance: state.attendance || {},
        holidays: state.holidays || {},
        holidayReasons: state.holidayReasons || {},
        basicInfos: state.basicInfos || {},
        basicInfoHistory: state.basicInfoHistory || {},
        counselings: state.counselings || [],
        supportLinks: (state.supportLinks || []).map(s => ({
          id: s.id,
          name: s.name,
          url: s.url,
          desc: s.desc
        })),
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error('Firebase 클라우드 저장 오류:', err);
    }
  }
}

// ============================================================================
// 3. 날짜 및 주간(월~금) 계산 유틸리티
// ============================================================================
function getMondayOfDate(dateObj) {
  const d = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
  const day = d.getDay(); // 0(일) ~ 6(토)
  const diff = day === 0 ? -6 : 1 - day; // 일요일이면 지난 월요일, 그 외에는 이번 주 월요일
  d.setDate(d.getDate() + diff);
  return d;
}

function formatDateYMD(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateDisplay(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}.${m}.${d}`;
}

function getWeekDaysMonToFri(mondayDate) {
  const dayNames = ['월', '화', '수', '목', '금'];
  const days = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(mondayDate);
    d.setDate(mondayDate.getDate() + i);
    days.push({
      dateObj: d,
      ymd: formatDateYMD(d),
      mmdd: `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`,
      dayKor: dayNames[i]
    });
  }
  return days;
}

function isNonSchoolDay(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay();
  // 토요일(6), 일요일(0)
  if (dow === 0 || dow === 6) return true;
  // 출석부에서 체크한 휴업일
  if (state.holidays && state.holidays[ymd]) return true;
  // 기본 법정공휴일(MM-DD)
  const mmdd = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (KOREAN_PUBLIC_HOLIDAYS_MMDD.has(mmdd)) return true;
  return false;
}

// ============================================================================
// 4. 출결 통계 및 관리 엔진 (수정.hwpx 양식 반영)
// - 급식관리: 모든 결석(A+B) 3일째 "급식중단(0000.00.00.)" 1회 표기 / 급식중단 후 결석 없는 하루만 "급식재개(0000.00.00.)" 1회 표기
// - 미인정결석 관리 1: A 연속 5일째 -> 연두색 바탕 검은색 볼드체 "미인정결석 연속 5일 (0000.00.00.)"
// - 미인정결석 관리 2: A 누적 35일째 -> 하늘색 바탕 검은색 볼드체 "미인정결석 누적 35일 (0000.00.00.)"
// - 허용 결석일수 관리: A+B 누적 50일째 -> 주황색 바탕 검은색 볼드체 "모든 결석 누적 50일"
// ============================================================================
function calculateStudentAttendanceStats(studentId, targetWeekDays = null) {
  const stuRecords = state.attendance[studentId] || {};
  const recordedDates = Object.keys(stuRecords).sort();

  let countA1 = 0; // 미인정결석(A)
  let countA2 = 0; // 기타결석(B)
  let total35Date = ''; // 누적 35일째 달성일

  for (const ymd of recordedDates) {
    if (state.holidays && state.holidays[ymd]) continue;
    const val = normalizeAttendanceValue(stuRecords[ymd]);
    if (val === 'A') {
      countA1++;
      if (countA1 === 35 && !total35Date) {
        total35Date = ymd;
      }
    } else if (val === 'B') {
      countA2++;
    }
  }

  const totalAll = countA1 + countA2;
  const isTotal35 = countA1 >= 35;
  const total35DateFormatted = total35Date ? total35Date.replace(/-/g, '.') + '.' : '';
  const isTotalAll50 = totalAll >= 50;

  // 대상 주간 (기본값: 현재 출석부에서 보고 있는 주간 또는 오늘 기준 주간)
  const effectiveWeek = targetWeekDays || ((typeof currentMonday !== 'undefined' && currentMonday)
    ? getWeekDaysMonToFri(currentMonday)
    : getWeekDaysMonToFri(new Date()));

  // A+B 연속 결석 및 A 연속 결석 계산 (주말, 공휴일, 휴업일은 건너뛰며 앞뒤 연결)
  let maxConsecutiveAll = 0; // A+B 최대 연속 결석
  let maxConsecutiveA1 = 0;  // A 최대 연속 결석
  let streak5Date = '';      // A 연속 5일째 달성일

  const allAbsenceDates = recordedDates.filter(ymd => {
    if (state.holidays && state.holidays[ymd]) return false;
    const mark = normalizeAttendanceValue(stuRecords[ymd]);
    return mark === 'A' || mark === 'B';
  });

  // 급식 중단/재개 사이클 리스트: [ { stopDate: 'YYYY-MM-DD', resumeDate: 'YYYY-MM-DD' | null }, ... ]
  const mealCycles = [];
  let currentMealCycle = null;
  let isMealStop = false;
  let isMealResume = false;
  let mealStopDateStr = '';
  let mealResumeDateStr = '';
  let mealDisplayType = 'NONE'; // 'NONE' | 'STOP' | 'BOTH'
  let mealEvents = [];

  if (allAbsenceDates.length > 0) {
    const todayStr = formatDateYMD(new Date());
    const lastAbsenceDate = allAbsenceDates[allAbsenceDates.length - 1];

    // 오늘 날짜 기준 이번 주의 금요일 (미래 주차 판별용)
    const todayMonday = getMondayOfDate(new Date());
    const todayFridayYmd = formatDateYMD(new Date(todayMonday.getFullYear(), todayMonday.getMonth(), todayMonday.getDate() + 4));
    const isViewingFutureWeek = effectiveWeek && effectiveWeek[0] && effectiveWeek[0].ymd > todayFridayYmd;

    // 시작일: 결석이 시작된 날과 현재 보고 있는 주의 시작일 중 빠른 날
    const minDateStr = (effectiveWeek && effectiveWeek[0] && effectiveWeek[0].ymd < allAbsenceDates[0])
      ? effectiveWeek[0].ymd
      : allAbsenceDates[0];

    // 종료일: 오늘 날짜, 마지막 결석일, 현재 주 금요일 중 평가 가능한 범위
    const maxEvaluationDate = lastAbsenceDate > todayStr ? lastAbsenceDate : todayStr;
    const targetEndStr = (effectiveWeek && effectiveWeek[effectiveWeek.length - 1]) ? effectiveWeek[effectiveWeek.length - 1].ymd : lastAbsenceDate;
    const maxDateStr = targetEndStr > maxEvaluationDate ? targetEndStr : maxEvaluationDate;

    const startParts = minDateStr.split('-').map(Number);
    const endParts = maxDateStr.split('-').map(Number);
    const cur = new Date(startParts[0], startParts[1] - 1, startParts[2]);
    const end = new Date(endParts[0], endParts[1] - 1, endParts[2]);

    let streakAll = 0;
    let streakA1 = 0;

    while (cur <= end) {
      const ymd = formatDateYMD(cur);
      if (isNonSchoolDay(ymd)) {
        // 토·일, 공휴일, 휴업일은 결석 스트릭 및 급식중단 상태를 끊지 않고 유지
      } else {
        const mark = normalizeAttendanceValue(stuRecords[ymd]);
        const hasAbsence = mark === 'A' || mark === 'B';

        // 오늘 이후이고 결석 입력이 없는 미래 날짜는 아직 도래하지 않았으므로 출석으로 처리하지 않음
        // (단, 사용자가 미래 주차로 넘어가서 조회하거나 지난주에 중단된 채 다음 주로 넘어온 경우는 빈칸을 정상 출석으로 평가)
        const isFutureUnrecorded = !isViewingFutureWeek && (ymd > todayStr) && !hasAbsence;

        if (isFutureUnrecorded) {
          // 미래 미도래일은 상태 변경 없이 통과
        } else if (hasAbsence) {
          // 결석 발생
          streakAll++;
          if (streakAll > maxConsecutiveAll) {
            maxConsecutiveAll = streakAll;
          }

          // [급식관리]: 결석(A+B) 연속 3일째 "급식중단(0000.00.00.)" 사이클 시작
          if (streakAll === 3) {
            currentMealCycle = {
              stopDate: ymd,
              resumeDate: null
            };
            mealCycles.push(currentMealCycle);
          }

          if (mark === 'A') {
            streakA1++;
            if (streakA1 === 5 && !streak5Date) {
              streak5Date = ymd;
            }
            if (streakA1 > maxConsecutiveA1) {
              maxConsecutiveA1 = streakA1;
            }
          } else {
            streakA1 = 0;
          }
        } else {
          // 결석 표시 없는 날 (출석)
          streakA1 = 0;
          streakAll = 0;

          // 만약 현재 중단 상태인 사이클이 있다면 복귀 첫 출석일이 재개일이 됨
          if (currentMealCycle && !currentMealCycle.resumeDate) {
            currentMealCycle.resumeDate = ymd;
            currentMealCycle = null; // 재개 완료되어 사이클 종료
          }
        }
      }
      cur.setDate(cur.getDate() + 1);
    }

    // 주간 표기 결정:
    // 1) 급식 3일째 "급식중단(0000.00.00.)" 발생 후 재개될 때까지는 그 주가 넘어가더라도 계속 중단 표시 유지
    // 2) "급식재개(0000.00.00.)"한 주에는 중단과 재개 둘 다 기록 ("급식중단(...)<br>급식재개(...)")
    // 3) 한 주에 급식 재개하고 또 중단이 되면 그 주에는 그 기록(재개 및 새 중단)이 모두 남아있어야 함!
    // 4) 재개된 주가 지난 이후에는 과거 사이클 표기 사라짐 (-)
    if (effectiveWeek && effectiveWeek.length > 0) {
      const weekMon = effectiveWeek[0].ymd;
      const weekFri = effectiveWeek[effectiveWeek.length - 1].ymd;

      // 이번 주와 관련된 급식 사이클들 탐색 (시간순)
      // - 이번 주보다 미래에 시작된 사이클 제외
      // - 이번 주 이전에 이미 재개 완료된 과거 사이클 제외
      const relatedCycles = mealCycles.filter(c => {
        if (c.stopDate > weekFri) return false;
        if (c.resumeDate && c.resumeDate < weekMon) return false;
        return true;
      });

      const seenEventKeys = new Set();
      const addMealEvent = (type, date) => {
        if (!date) return;
        const key = `${type}_${date}`;
        if (seenEventKeys.has(key)) return;
        seenEventKeys.add(key);

        const dateDot = date.replace(/-/g, '.') + '.';
        const text = type === 'STOP' ? `급식중단(${dateDot})` : `급식재개(${dateDot})`;
        mealEvents.push({
          type,
          date,
          dateStr: dateDot,
          text
        });
      };

      relatedCycles.forEach(c => {
        // 중단 이벤트 추가: 이 사이클이 이번 주에 걸쳐 있는 경우 (재개되었거나 유지 중이거나 이번 주에 중단된 경우)
        addMealEvent('STOP', c.stopDate);

        // 재개 이벤트 추가: 이번 주 범위(월~금) 내에 재개된 경우에만 재개 기록 추가
        if (c.resumeDate && c.resumeDate >= weekMon && c.resumeDate <= weekFri) {
          addMealEvent('RESUME', c.resumeDate);
        }
      });

      // 날짜 순 정렬 (동일 날짜일 경우 STOP 우선)
      mealEvents.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.type === 'STOP' ? -1 : 1;
      });

      if (mealEvents.length > 0) {
        const hasStop = mealEvents.some(e => e.type === 'STOP');
        const hasResume = mealEvents.some(e => e.type === 'RESUME');

        isMealStop = hasStop;
        isMealResume = hasResume;

        const latestStop = [...mealEvents].reverse().find(e => e.type === 'STOP');
        const latestResume = [...mealEvents].reverse().find(e => e.type === 'RESUME');

        mealStopDateStr = latestStop ? latestStop.dateStr : '';
        mealResumeDateStr = latestResume ? latestResume.dateStr : '';

        if (hasStop && hasResume) {
          mealDisplayType = 'BOTH';
        } else if (hasStop) {
          mealDisplayType = 'STOP';
        } else if (hasResume) {
          mealDisplayType = 'RESUME';
        }
      }
    }
  }

  const mealEventsList = mealEvents;
  let mealHtml = '-';
  let mealTitle = '';
  if (mealEventsList.length > 0) {
    mealHtml = mealEventsList.map(e => {
      const cls = e.type === 'STOP' ? 'meal-line-stop' : 'meal-line-resume';
      return `<span class="${cls}">${e.text}</span>`;
    }).join('');
    mealTitle = mealEventsList.map(e => e.text).join(' / ');
  } else if (mealDisplayType === 'STOP') {
    mealHtml = `급식중단(${mealStopDateStr})`;
    mealTitle = `급식중단: ${mealStopDateStr}`;
  }

  // 2) 미인정결석 관리 (연속 5일째):
  const isStreak5 = maxConsecutiveA1 >= 5;
  const streak5DateFormatted = streak5Date ? streak5Date.replace(/-/g, '.') + '.' : '';

  // 특이사항이 있는지 여부 ([출결관리] 필터용)
  const hasAnyIssue = isMealStop || isMealResume || isStreak5 || isTotal35 || isTotalAll50 || countA1 > 0 || totalAll > 0;

  return {
    countA1,
    countA2,
    totalAll,
    maxConsecutiveAll,
    maxConsecutiveA1,
    isMealStop,
    mealStopDateStr,
    isMealResume,
    mealResumeDateStr,
    mealDisplayType,
    mealEvents: mealEventsList,
    mealHtml,
    mealTitle,
    resumeDateStr: mealResumeDateStr, // 구버전 호환용
    isStreak5,
    streak5Date,
    streak5DateStr: streak5DateFormatted,
    isTotal35,
    total35Date,
    total35DateStr: total35DateFormatted,
    isTotalAll50,
    hasAnyIssue
  };
}

// ============================================================================
// 5. 화면 렌더링 함수들
// ============================================================================
function renderAll() {
  renderAttendanceSection();
  renderBasicInfoSection();
  renderCounselingSection();
  renderSupportSection();
  renderHomeroomSection();
  renderAdminSection();
  updateClassSwitcherOptions();
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// -------------------- 5-1. [출석부] 렌더링 --------------------
function renderAttendanceSection() {
  const weekDays = getWeekDaysMonToFri(currentMonday);
  const fridayDate = weekDays[4].dateObj;
  const rangeEl = document.getElementById('current-week-range');
  if (rangeEl) {
    rangeEl.textContent = `${formatDateDisplay(currentMonday)} (월) ~ ${formatDateDisplay(fridayDate)} (금)`;
  }

  // 월~금 5개 요일 헤더 + 휴업일 체크박스 + 공휴일/휴업 사유 또는 행사명 입력칸 업데이트 (2단 헤더 1행)
  const dayThs = document.querySelectorAll('#attendance-thead-row-1 th.col-day');
  weekDays.forEach((dayInfo, idx) => {
    const th = dayThs[idx];
    if (!th) return;
    const isHoliday = Boolean(state.holidays[dayInfo.ymd]);
    const holidayReason = state.holidayReasons?.[dayInfo.ymd] || '';
    th.classList.toggle('is-holiday-col', isHoliday);
    th.innerHTML = `
      <div class="day-header-cell">
        <span class="day-header-date">${dayInfo.mmdd} (${dayInfo.dayKor})</span>
        <label class="holiday-check-label" title="체크 시 휴업일로 지정되어 회색으로 변경되고 결석 입력이 비활성화됩니다.">
          <input type="checkbox" class="chk-holiday" data-ymd="${dayInfo.ymd}" ${isHoliday ? 'checked' : ''} />
          <span>휴업일</span>
        </label>
        <input
          type="text"
          class="holiday-reason-input"
          data-ymd="${dayInfo.ymd}"
          placeholder="사유/행사명"
          value="${escapeHtml(holidayReason)}"
          title="공휴일/휴업 사유 또는 행사명을 입력하세요 (선택입력)"
        />
      </div>
    `;
  });

  // 휴업일 체크박스 이벤트 연결
  document.querySelectorAll('.chk-holiday').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const ymd = e.target.getAttribute('data-ymd');
      if (e.target.checked) {
        state.holidays[ymd] = true;
      } else {
        delete state.holidays[ymd];
      }
      saveState();
      renderAll();
    });
  });

  // 공휴일/휴업 사유 또는 행사명 입력 이벤트 연결 (저장)
  document.querySelectorAll('.holiday-reason-input').forEach(input => {
    input.addEventListener('input', (e) => {
      const ymd = e.target.getAttribute('data-ymd');
      const val = e.target.value.trim();
      if (!state.holidayReasons) state.holidayReasons = {};
      if (val) {
        state.holidayReasons[ymd] = val;
      } else {
        delete state.holidayReasons[ymd];
      }
      saveState();
    });
  });

  // 출석부 학생 행 렌더링
  const tbody = document.getElementById('attendance-tbody');
  if (!tbody) return;

  if (state.students.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" style="padding: 2rem; color: #6c757d;">
          등록된 학생이 없습니다. 아래 <strong>[관리자] &rarr; [출석부]</strong> 메뉴에서 학생을 추가해주세요.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = state.students.map(stu => {
    const stuAtt = state.attendance[stu.id] || {};
    const stats = calculateStudentAttendanceStats(stu.id, weekDays);

    const dayCellsHtml = weekDays.map(dayInfo => {
      const isHoliday = Boolean(state.holidays[dayInfo.ymd]);
      const rawVal = isHoliday ? '' : (stuAtt[dayInfo.ymd] || '');
      const normVal = normalizeAttendanceValue(rawVal);
      const displayVal = (normVal === 'A' || normVal === 'B') ? normVal : (rawVal || '');
      const valClass = displayVal === 'A' ? 'val-a1' : (displayVal === 'B' ? 'val-a2' : '');

      return `
        <td class="${isHoliday ? 'is-holiday-col' : ''}">
          <input
            type="text"
            class="att-input ${valClass}"
            data-stu-id="${stu.id}"
            data-ymd="${dayInfo.ymd}"
            value="${escapeHtml(displayVal)}"
            maxlength="2"
            autocomplete="off"
            spellcheck="false"
            placeholder="${isHoliday ? '휴업' : ''}"
            ${isHoliday ? 'disabled' : ''}
            title="미인정결석: A (또는 1, ㅁ), 기타결석: B (또는 2, ㅠ), 출석: 빈칸 (스페이스바 토글 가능)"
          />
        </td>
      `;
    }).join('');

    return `
      <tr data-row-stu="${stu.id}">
        <td><strong>${escapeHtml(stu.studentNo)}</strong></td>
        <td><strong>${escapeHtml(stu.name)}</strong></td>
        ${dayCellsHtml}
        <td class="col-cell-meal cell-mgt ${stats.mealDisplayType === 'BOTH' ? 'cell-meal-both' : (stats.mealDisplayType === 'STOP' ? 'cell-meal-stop' : '')} ${(stats.mealEvents && stats.mealEvents.length > 2) ? 'meal-multi' : ''}"
            title="${escapeHtml(stats.mealTitle || '')}">
          ${stats.mealHtml}
        </td>
        <td class="col-cell-unauth-streak cell-mgt ${stats.isStreak5 ? 'cell-unauth-streak5' : ''}">
          ${stats.isStreak5 ? `미인정결석<br>연속 5일<br>(${stats.streak5DateStr || '-'})` : '-'}
        </td>
        <td class="col-cell-unauth-total cell-mgt ${stats.isTotal35 ? 'cell-unauth-total35' : ''}">
          ${stats.isTotal35 ? `미인정결석<br>누적 35일<br>(${stats.total35DateStr || '-'})` : '-'}
        </td>
        <td class="col-cell-allowed cell-mgt ${stats.isTotalAll50 ? 'cell-allowed-50' : ''}">
          ${stats.isTotalAll50 ? '모든 결석<br>누적 50일' : '-'}
        </td>
      </tr>
    `;
  }).join('');

  // 출결 입력 이벤트 바인딩 (직접 입력: 빈칸, A, B / 키보드 단축키 및 스페이스바 지원)
  tbody.querySelectorAll('.att-input').forEach(input => {
    // 포커스 시 전체 선택 (바로 덮어쓰기 편리)
    input.addEventListener('focus', (e) => {
      e.target.select();
    });

    // 스페이스바 누르면: 빈칸 -> A -> B -> 빈칸 순환
    input.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        const stuId = input.getAttribute('data-stu-id');
        const ymd = input.getAttribute('data-ymd');
        const currentNorm = normalizeAttendanceValue(input.value);

        let nextVal = '';
        if (currentNorm === '') nextVal = 'A';
        else if (currentNorm === 'A') nextVal = 'B';
        else if (currentNorm === 'B') nextVal = '';
        else nextVal = 'A';

        if (!state.attendance[stuId]) state.attendance[stuId] = {};
        if (nextVal) {
          state.attendance[stuId][ymd] = nextVal;
        } else {
          delete state.attendance[stuId][ymd];
        }

        input.value = nextVal;
        input.classList.toggle('val-a1', nextVal === 'A');
        input.classList.toggle('val-a2', nextVal === 'B');

        saveState();
        updateSingleStudentRowStats(stuId);
        renderCounselingSection();
        renderHomeroomSection();
        renderAdminSection();
      }
    });

    input.addEventListener('input', (e) => {
      const stuId = e.target.getAttribute('data-stu-id');
      const ymd = e.target.getAttribute('data-ymd');
      const rawVal = e.target.value;
      const normVal = normalizeAttendanceValue(rawVal);

      if (!state.attendance[stuId]) {
        state.attendance[stuId] = {};
      }

      if (normVal === 'A' || normVal === 'B') {
        state.attendance[stuId][ymd] = normVal;
        e.target.value = normVal; // 즉시 대문자 A 또는 B로 표기
      } else if (normVal === '') {
        delete state.attendance[stuId][ymd];
        e.target.value = '';
      } else {
        // 타이핑 조합 중인 경우
        state.attendance[stuId][ymd] = rawVal.toUpperCase();
      }

      const curVal = state.attendance[stuId] ? (state.attendance[stuId][ymd] || '') : '';
      e.target.classList.toggle('val-a1', curVal === 'A');
      e.target.classList.toggle('val-a2', curVal === 'B');

      saveState();
      updateSingleStudentRowStats(stuId);
      renderCounselingSection();
      renderHomeroomSection();
      renderAdminSection();
    });

    input.addEventListener('blur', (e) => {
      const rawVal = e.target.value;
      const normVal = normalizeAttendanceValue(rawVal);
      const stuId = e.target.getAttribute('data-stu-id');
      const ymd = e.target.getAttribute('data-ymd');

      if (normVal === 'A' || normVal === 'B') {
        e.target.value = normVal;
        if (!state.attendance[stuId]) state.attendance[stuId] = {};
        state.attendance[stuId][ymd] = normVal;
        e.target.classList.toggle('val-a1', normVal === 'A');
        e.target.classList.toggle('val-a2', normVal === 'B');
      } else if (normVal === '') {
        e.target.value = '';
        if (state.attendance[stuId]) {
          delete state.attendance[stuId][ymd];
        }
        e.target.classList.remove('val-a1', 'val-a2');
      } else {
        alert('출결 입력란에는 미인정결석(A 또는 1, ㅁ), 그 외 결석(B 또는 2, ㅠ)만 입력하거나 출석 시 빈칸으로 두세요.\n(스페이스바를 누르면 빈칸 → A → B 순서로 쉽게 변경할 수 있습니다.)');
        e.target.value = '';
        if (state.attendance[stuId]) {
          delete state.attendance[stuId][ymd];
        }
        e.target.classList.remove('val-a1', 'val-a2');
      }

      saveState();
      updateSingleStudentRowStats(stuId);
      renderCounselingSection();
      renderHomeroomSection();
      renderAdminSection();
    });
  });
}

// 입력 중 포커스를 유지하기 위해 해당 행의 누적/관리 열만 즉시 업데이트
function updateSingleStudentRowStats(stuId) {
  const row = document.querySelector(`tr[data-row-stu="${stuId}"]`);
  if (!row) return;
  const weekDays = getWeekDaysMonToFri(currentMonday);
  const stats = calculateStudentAttendanceStats(stuId, weekDays);

  const cMeal = row.querySelector('.col-cell-meal');
  const cUnauthStreak = row.querySelector('.col-cell-unauth-streak');
  const cUnauthTotal = row.querySelector('.col-cell-unauth-total');
  const cAllowed = row.querySelector('.col-cell-allowed');

  if (cMeal) {
    if (stats.mealEvents && stats.mealEvents.length > 0) {
      const isMultiMeal = stats.mealEvents.length > 2;
      const mealCellClass = stats.mealDisplayType === 'BOTH'
        ? 'cell-meal-both'
        : (stats.mealDisplayType === 'STOP' ? 'cell-meal-stop' : '');
      cMeal.className = `col-cell-meal cell-mgt ${mealCellClass} ${isMultiMeal ? 'meal-multi' : ''}`;
      cMeal.innerHTML = stats.mealHtml;
      cMeal.title = stats.mealTitle || '';
    } else if (stats.mealDisplayType === 'STOP') {
      cMeal.className = 'col-cell-meal cell-mgt cell-meal-stop';
      cMeal.innerHTML = `급식중단(${stats.mealStopDateStr})`;
      cMeal.title = `급식중단: ${stats.mealStopDateStr}`;
    } else {
      cMeal.className = 'col-cell-meal cell-mgt';
      cMeal.innerHTML = '-';
      cMeal.title = '';
    }
  }

  if (cUnauthStreak) {
    if (stats.isStreak5) {
      cUnauthStreak.className = 'col-cell-unauth-streak cell-mgt cell-unauth-streak5';
      cUnauthStreak.innerHTML = `미인정결석<br>연속 5일<br>(${stats.streak5DateStr || '-'})`;
    } else {
      cUnauthStreak.className = 'col-cell-unauth-streak cell-mgt';
      cUnauthStreak.innerHTML = '-';
    }
  }

  if (cUnauthTotal) {
    if (stats.isTotal35) {
      cUnauthTotal.className = 'col-cell-unauth-total cell-mgt cell-unauth-total35';
      cUnauthTotal.innerHTML = `미인정결석<br>누적 35일<br>(${stats.total35DateStr || '-'})`;
    } else {
      cUnauthTotal.className = 'col-cell-unauth-total cell-mgt';
      cUnauthTotal.innerHTML = '-';
    }
  }

  if (cAllowed) {
    if (stats.isTotalAll50) {
      cAllowed.className = 'col-cell-allowed cell-mgt cell-allowed-50';
      cAllowed.innerHTML = '모든 결석<br>누적 50일';
    } else {
      cAllowed.className = 'col-cell-allowed cell-mgt';
      cAllowed.innerHTML = '-';
    }
  }
}

// [학생기본자료] 스키마 조회 헬퍼
function getBasicInfoSchema() {
  if (!state.basicInfoSchema || !Array.isArray(state.basicInfoSchema) || state.basicInfoSchema.length === 0) {
    state.basicInfoSchema = JSON.parse(JSON.stringify(DEFAULT_BASIC_INFO_SCHEMA));
  }
  return state.basicInfoSchema;
}

// 학생별 기본자료 조회 헬퍼
function getStudentBasicInfo(studentId) {
  if (!state.basicInfos) state.basicInfos = {};
  const raw = state.basicInfos[studentId] || {};
  return {
    recordDate: raw.recordDate || '',
    familyTypes: Array.isArray(raw.familyTypes) ? raw.familyTypes : [],
    familyEtc: raw.familyEtc || '',
    economicStatus: raw.economicStatus || '',
    careerHopes: Array.isArray(raw.careerHopes) ? raw.careerHopes : [],
    careerEtc: raw.careerEtc || '',
    attitudePositive: Array.isArray(raw.attitudePositive) ? raw.attitudePositive : [],
    attitudePosEtc: raw.attitudePosEtc || '',
    problemBehaviors: Array.isArray(raw.problemBehaviors) ? raw.problemBehaviors : [],
    attitudeNegEtc: raw.attitudeNegEtc || '',
    guidanceAuto: Array.isArray(raw.guidanceAuto) ? raw.guidanceAuto : [],
    guidanceCustom: raw.guidanceCustom || '',
    customValues: (raw.customValues && typeof raw.customValues === 'object') ? raw.customValues : {}
  };
}

// 중항목별 저장된 값 및 기타 입력값 조회
function getCategoryValues(info, catId) {
  if (!info) return { selected: [], etc: '' };
  if (catId === 'familyType') {
    return { selected: Array.isArray(info.familyTypes) ? info.familyTypes : [], etc: info.familyEtc || '' };
  }
  if (catId === 'economicStatus') {
    const val = info.economicStatus || '';
    return { selected: val ? [val] : [], etc: '' };
  }
  if (catId === 'careerHope') {
    return { selected: Array.isArray(info.careerHopes) ? info.careerHopes : [], etc: info.careerEtc || '' };
  }
  if (catId === 'attitudePositive') {
    return { selected: Array.isArray(info.attitudePositive) ? info.attitudePositive : [], etc: info.attitudePosEtc || '' };
  }
  if (catId === 'problemBehavior') {
    return { selected: Array.isArray(info.problemBehaviors) ? info.problemBehaviors : [], etc: info.attitudeNegEtc || '' };
  }
  if (info.customValues && info.customValues[catId]) {
    const cv = info.customValues[catId];
    return {
      selected: Array.isArray(cv.selected) ? cv.selected : (Array.isArray(cv.values) ? cv.values : []),
      etc: cv.etc || ''
    };
  }
  return { selected: [], etc: '' };
}

// 중항목별 표시 텍스트 포맷 (기타 입력값 결합)
function formatCategoryText(info, cat) {
  const catId = typeof cat === 'string' ? cat : (cat && cat.id ? cat.id : '');
  const { selected, etc } = getCategoryValues(info, catId);
  if (!selected || selected.length === 0) return '-';
  const formatted = selected.map(item => {
    if (item === '기타' && etc) return `기타(${etc})`;
    return item;
  });
  return formatted.join(', ');
}

// 지도방안 자동 제안 계산 함수
// - 리더십, 봉사, 선행, 배려, 기타(긍정) 중 2개 이상 체크 시 "교내장학 추천 대상"
// - 교내장학 추천 대상 요건에 경제적 여건이 중하 또는 하인 경우 "외부장학 추천 대상"
// - 자해 또는 자살생각 체크 시 "심리상담센터 연계"
function calculateAutoGuidance(info) {
  const tags = [];
  const posList = info.attitudePositive || [];
  if (posList.length >= 2) {
    tags.push('교내장학 추천 대상');
    const econ = info.economicStatus || '';
    if (econ === '중하' || econ === '하') {
      tags.push('외부장학 추천 대상');
    }
  }

  const negList = info.problemBehaviors || [];
  if (negList.includes('자해') || negList.includes('자살생각')) {
    tags.push('심리상담센터 연계');
  }

  return tags;
}

function formatFamilyText(info) {
  return formatCategoryText(info, 'familyType');
}

function formatCareerText(info) {
  return formatCategoryText(info, 'careerHope');
}

function formatAttitudePosText(info) {
  const text = formatCategoryText(info, 'attitudePositive');
  return text === '-' ? '' : text;
}

function formatAttitudeNegText(info) {
  const text = formatCategoryText(info, 'problemBehavior');
  return text === '-' ? '' : text;
}

function formatGuidanceText(info) {
  if (!info) return '';
  const autoTags = (info.guidanceAuto && info.guidanceAuto.length > 0)
    ? info.guidanceAuto
    : calculateAutoGuidance(info);
  const items = [...autoTags];
  if (info.guidanceCustom) {
    items.push(info.guidanceCustom);
  }
  return items.join(', ');
}

function renderBasicInfoSummaryBadges(studentId) {
  if (!state.basicInfos || !state.basicInfos[studentId] || !state.basicInfos[studentId].recordDate) {
    return `<span style="color:#888; font-size:0.8rem;">미입력</span>`;
  }
  const info = getStudentBasicInfo(studentId);
  const schema = getBasicInfoSchema();
  const parts = [];

  schema.forEach(cat => {
    const text = formatCategoryText(info, cat);
    if (text && text !== '-') {
      const cleanName = cat.name.replace(/\[.*?\]/g, '').trim();
      parts.push(`${cleanName}:${text}`);
    }
  });

  const guideStr = formatGuidanceText(info);
  if (guideStr) parts.push(`지도:${guideStr}`);

  if (parts.length === 0) {
    return `<span style="color:#888; font-size:0.8rem;">미입력</span>`;
  }
  return `<div style="font-size:0.8rem; color:#444; margin-bottom:0.25rem;">${escapeHtml(parts.join(' | '))}</div>`;
}

// 미인정결석 누적 35일 달성일 상담 자동 등록 함수 (미인정결석 연속 5일 자동 상담은 완전 폐지 및 기존 행 삭제)
function syncMilestoneCounselingsForStudent(studentId) {
  const stu = state.students.find(s => s.id === studentId);
  if (!stu) return;
  const stats = calculateStudentAttendanceStats(studentId);

  // 1) [미인정결석 연속 5일 자동 상담란 생성 기능 완전 폐지]: 기존 남아있는 연속 5일 관련 기록 즉시 완전 삭제
  if (Array.isArray(state.counselings)) {
    state.counselings = state.counselings.filter(c => {
      if (c.studentId !== studentId) return true;
      return !isStreak5MilestoneCounseling(c);
    });
  }

  // 2) 미인정결석 누적 35일째 (누적 35일만 유지)
  if (stats.isTotal35 && stats.total35Date) {
    let item = (state.counselings || []).find(c => c.studentId === studentId && (c.id === `milestone-total35-${studentId}` || c.isMilestone === 'total35'));
    if (!item) {
      state.counselings.push({
        id: `milestone-total35-${studentId}`,
        studentId: stu.id,
        studentNo: stu.studentNo,
        studentName: stu.name,
        date: stats.total35Date,
        content: '',
        isMilestone: 'total35',
        milestoneType: '미인정결석 누적 35일'
      });
    } else {
      if (!item.date || item.date !== stats.total35Date) {
        item.date = stats.total35Date;
      }
      item.isMilestone = 'total35';
      item.milestoneType = '미인정결석 누적 35일';
    }
  } else {
    // [해제 시 자동 삭제]: 출석부에서 누적 35일이 지워지거나 해제되었을 때 자동 생성된 마일스톤 상담 행 즉시 삭제
    if (Array.isArray(state.counselings)) {
      state.counselings = state.counselings.filter(c => {
        if (c.studentId !== studentId) return true;
        const isT35 = (c.id === `milestone-total35-${studentId}` || c.isMilestone === 'total35');
        // 내용이 아직 작성되지 않은 빈 마일스톤 행이면 해제 시 삭제
        if (isT35 && (!c.content || !c.content.trim())) {
          return false;
        }
        return true;
      });
    }
  }
}

// -------------------- 5-2. [학생기본자료] 렌더링 --------------------
function renderBasicInfoSection() {
  const tbody = document.getElementById('basic-info-student-tbody');
  if (!tbody) return;

  if (state.students.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="padding: 2rem; color: #6c757d; text-align:center;">
          출석부에 등록된 학생이 없습니다. 관리자 또는 담임관리 메뉴에서 학생을 등록해주세요.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = state.students.map((stu, idx) => {
    const info = getStudentBasicInfo(stu.id);
    const dateDisplay = info.recordDate || '-';
    const summaryBadges = renderBasicInfoSummaryBadges(stu.id);

    return `
      <tr>
        <td>${idx + 1}</td>
        <td><strong>${escapeHtml(stu.studentNo)}</strong></td>
        <td><strong>${escapeHtml(stu.name)}</strong></td>
        <td>
          <div style="display:flex; align-items:center; justify-content:center; gap:0.4rem;">
            <button class="btn btn-sky btn-open-basic-info" data-stu-id="${stu.id}">
              📋 기본자료 설정
            </button>
            <button class="btn btn-danger-sm btn-reset-basic-info" data-stu-id="${stu.id}" title="${escapeHtml(stu.name)} 학생의 기본자료를 모두 지우고 초기화합니다.">
              <i data-lucide="rotate-ccw" style="width:13px; height:13px; vertical-align:middle; margin-right:2px;"></i>초기화
            </button>
          </div>
        </td>
        <td style="font-weight:700; color:#1971c2;">${escapeHtml(dateDisplay)}</td>
        <td style="text-align:left;">${summaryBadges}</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.btn-open-basic-info').forEach(btn => {
    btn.addEventListener('click', () => {
      const stuId = btn.getAttribute('data-stu-id');
      openBasicInfoModal(stuId);
    });
  });

  tbody.querySelectorAll('.btn-reset-basic-info').forEach(btn => {
    btn.addEventListener('click', () => {
      const stuId = btn.getAttribute('data-stu-id');
      resetStudentBasicInfo(stuId);
    });
  });
}

// -------------------- 5-3. [상담기록] 렌더링 --------------------
function renderCounselingSection() {
  const tbody = document.getElementById('counseling-student-tbody');
  if (!tbody) return;

  if (state.students.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="padding: 2rem; color: #6c757d; text-align:center;">
          출석부에 등록된 학생이 없습니다.
        </td>
      </tr>
    `;
    return;
  }

  // 모든 학생의 마일스톤 상담 자동 동기화
  state.students.forEach(stu => syncMilestoneCounselingsForStudent(stu.id));

  tbody.innerHTML = state.students.map((stu, idx) => {
    const stuCounsels = state.counselings.filter(c => c.studentId === stu.id);
    // 내용이 작성된 상담 수 카운트
    const counselCount = stuCounsels.filter(c => (c.content || '').trim()).length;
    const stats = calculateStudentAttendanceStats(stu.id);

    // 특이사항 및 최근 상담 요약 (누적 35일 달성 마일스톤만 관리)
    const badges = [];
    if (stats.isTotal35) {
      badges.push(`<span class="milestone-badge-tag" style="background:#e7f5ff; color:#1971c2; border-color:#a5d8ff;">누적 35일 달성 (${stats.total35DateStr || '-'})</span>`);
    }

    const writtenCounsels = stuCounsels.filter(c => (c.content || '').trim());
    const latestCounsel = writtenCounsels[writtenCounsels.length - 1];
    let counselSummary = '';
    if (latestCounsel) {
      const shortText = latestCounsel.content.length > 32 ? latestCounsel.content.slice(0, 32) + '...' : latestCounsel.content;
      counselSummary = `<span style="font-size:0.84rem; color:#495057;">[${latestCounsel.date}] ${escapeHtml(shortText)}</span>`;
    } else {
      counselSummary = `<span style="color:#aaa; font-size:0.82rem;">(작성된 상담 내용 없음)</span>`;
    }

    const extraHtml = (badges.length > 0)
      ? `<div style="display:flex; flex-wrap:wrap; gap:0.35rem; align-items:center; margin-bottom:0.25rem;">${badges.join('')}</div>${counselSummary}`
      : counselSummary;

    return `
      <tr>
        <td>${idx + 1}</td>
        <td><strong>${escapeHtml(stu.studentNo)}</strong></td>
        <td><strong>${escapeHtml(stu.name)}</strong></td>
        <td>
          <button class="btn btn-green btn-open-counsel" data-stu-id="${stu.id}">
            💬 상담기록
          </button>
        </td>
        <td>
          <span class="counsel-count-pill">${counselCount}회</span>
        </td>
        <td style="text-align:left;">
          ${extraHtml}
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.btn-open-counsel').forEach(btn => {
    btn.addEventListener('click', () => {
      const stuId = btn.getAttribute('data-stu-id');
      openCounselModal(stuId);
    });
  });
}

function renderStatsBadgesHtml(stats) {
  const badges = [];
  if (stats.mealEvents && stats.mealEvents.length > 0) {
    stats.mealEvents.forEach(e => {
      if (e.type === 'STOP') {
        badges.push(`<span class="mini-badge" style="background:#fff3bf; color:#d90429; font-weight:800;">급식중단(${e.dateStr})</span>`);
      } else if (e.type === 'RESUME') {
        badges.push(`<span class="mini-badge" style="background:#ffffff; color:#1971c2; border:1px solid #a5d8ff; font-weight:800;">급식재개(${e.dateStr})</span>`);
      }
    });
  } else if (stats.mealDisplayType === 'BOTH') {
    badges.push(`<span class="mini-badge" style="background:#fff3bf; color:#d90429; font-weight:800;">급식중단(${stats.mealStopDateStr})</span>`);
    badges.push(`<span class="mini-badge" style="background:#ffffff; color:#1971c2; border:1px solid #a5d8ff; font-weight:800;">급식재개(${stats.mealResumeDateStr})</span>`);
  } else if (stats.mealDisplayType === 'STOP') {
    badges.push(`<span class="mini-badge" style="background:#fff3bf; color:#d90429; font-weight:800;">급식중단(${stats.mealStopDateStr})</span>`);
  }
  badges.push(`<span class="mini-badge a1">미인정(A): ${stats.countA1}일</span>`);
  badges.push(`<span class="mini-badge a2">모든결석(A+B): ${stats.totalAll}일</span>`);
  if (stats.isStreak5) {
    badges.push(`<span class="mini-badge s5" style="background:#d3f9d8; color:#111; font-weight:800;">미인정 연속 5일 (${stats.streak5DateStr || '-'})</span>`);
  }
  if (stats.isTotal35) {
    badges.push(`<span class="mini-badge t35" style="background:#d0ebff; color:#111; font-weight:800;">미인정 누적 35일 (${stats.total35DateStr || '-'})</span>`);
  }
  if (stats.isTotalAll50) {
    badges.push(`<span class="mini-badge t50" style="background:#ffd8a8; color:#111; font-weight:800;">모든 결석 누적 50일</span>`);
  }
  return badges.join(' ');
}

// -------------------- 5-3. [지원] 섹션 렌더링 --------------------
function renderSupportSection() {
  const container = document.getElementById('support-links-container');
  if (!container) return;

  const links = state.supportLinks || [];
  if (links.length === 0) {
    container.innerHTML = `
      <div class="support-empty-card">
        <div class="empty-icon">🏢</div>
        <h3>등록된 지원 기관 정보가 없습니다</h3>
        <p>
          학생 복지 및 전문 상담 지원을 위해 상단 <strong>[관리자]</strong> 메뉴의 <strong>[지원 기관 링크 설정]</strong>에서 유관 기관(청소년상담복지센터, Wee센터, 복지관 등)을 등록해보세요.
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = links.map(item => {
    const cleanUrl = normalizeUrl(item.url);
    const descHtml = item.desc ? `<div class="support-card-desc">${escapeHtml(item.desc)}</div>` : '';
    return `
      <div class="support-card">
        <div class="support-card-top">
          <div class="support-card-header">
            <span class="support-badge"><i data-lucide="building-2" style="width:13px;height:13px;"></i> 유관기관</span>
          </div>
          <a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="support-card-name" title="새 탭에서 사이트 열기">
            <span>${escapeHtml(item.name || '기관명 미입력')}</span>
            <i data-lucide="external-link" style="width:16px;height:16px; flex-shrink:0;"></i>
          </a>
          <a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="support-card-url" title="새 탭에서 사이트 열기">
            <i data-lucide="globe" style="width:14px;height:14px; flex-shrink:0;"></i>
            <span>${escapeHtml(item.url || '-')}</span>
          </a>
          ${descHtml}
        </div>
        <div class="support-card-footer">
          <a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="btn-support-visit">
            <span>홈페이지 바로가기</span>
            <i data-lucide="arrow-up-right" style="width:14px;height:14px;"></i>
          </a>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// -------------------- 5-3-B. [담임관리] 렌더링 --------------------
function renderHomeroomSection() {
  renderHomeroomStudentsTable();
  renderHomeroomCounselTable();
  renderHomeroomAttendanceCareTable();
  updateHomeroomBanner();
}

function updateHomeroomBanner() {
  const badge = document.getElementById('homeroom-current-class-badge');
  if (!badge) return;
  if (currentActiveAccountId === 'admin') {
    badge.textContent = '👑 관리자 학급 관리';
  } else {
    const tch = (state.teachers || []).find(t => t.id === currentActiveAccountId);
    badge.textContent = tch ? `👩‍🏫 ${tch.name} 선생님 (${tch.note || '학급'}) 관리` : '👩‍🏫 담임교사 학급 관리';
  }
}

function updateClassSwitcherOptions() {
  const select = document.getElementById('select-active-class');
  if (!select) return;

  const options = [
    `<option value="admin">👑 관리자 본인 학급</option>`
  ];

  (state.teachers || []).forEach(tch => {
    options.push(`<option value="${tch.id}">👩‍🏫 ${escapeHtml(tch.name)} 선생님 (${escapeHtml(tch.note || '학급')})</option>`);
  });

  select.innerHTML = options.join('');
  select.value = currentActiveAccountId;
}

function renderHomeroomStudentsTable() {
  const tbody = document.getElementById('homeroom-student-tbody');
  if (!tbody) return;

  if (state.students.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="3" style="padding: 1.5rem; color: #6c757d;">
          [+ 행 추가] 버튼을 눌러 학급 학생의 학번과 이름을 등록하세요.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = state.students.map(stu => {
    const editing = Boolean(stu.isEditing);
    return `
      <tr data-homeroom-stu="${stu.id}">
        <td>
          <input
            type="text"
            class="admin-input inp-stu-no"
            value="${escapeHtml(stu.studentNo)}"
            placeholder="학번 입력 (예: 10101)"
            ${editing ? '' : 'disabled'}
          />
        </td>
        <td>
          <input
            type="text"
            class="admin-input inp-stu-name"
            value="${escapeHtml(stu.name)}"
            placeholder="이름 입력 (예: 홍길동)"
            ${editing ? '' : 'disabled'}
          />
        </td>
        <td>
          <div class="row-action-btns">
            <button class="btn btn-primary btn-save-homeroom-stu" data-id="${stu.id}" style="padding:0.38rem 0.7rem; font-size:0.8rem;">
              저장
            </button>
            <button class="btn btn-outline-sm btn-edit-homeroom-stu" data-id="${stu.id}">
              수정
            </button>
            <button class="btn-danger-sm btn-del-homeroom-stu" data-id="${stu.id}">
              삭제
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // 저장 버튼
  tbody.querySelectorAll('.btn-save-homeroom-stu').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const row = tbody.querySelector(`tr[data-homeroom-stu="${id}"]`);
      const noVal = row.querySelector('.inp-stu-no').value.trim();
      const nameVal = row.querySelector('.inp-stu-name').value.trim();

      if (!noVal || !nameVal) {
        alert('학번과 이름을 모두 입력해주세요.');
        return;
      }

      const stu = state.students.find(s => s.id === id);
      if (stu) {
        stu.studentNo = noVal;
        stu.name = nameVal;
        stu.isEditing = false;

        // 상담 내역의 학번/이름도 동기화
        state.counselings.forEach(c => {
          if (c.studentId === id) {
            c.studentNo = noVal;
            c.studentName = nameVal;
          }
        });

        saveState();
        renderAll();
      }
    });
  });

  // 수정 버튼
  tbody.querySelectorAll('.btn-edit-homeroom-stu').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const stu = state.students.find(s => s.id === id);
      if (stu) {
        stu.isEditing = true;
        renderHomeroomStudentsTable();
        renderAdminStudentsTable();
        const row = tbody.querySelector(`tr[data-homeroom-stu="${id}"]`);
        if (row) row.querySelector('.inp-stu-no')?.focus();
      }
    });
  });

  // 삭제 버튼
  tbody.querySelectorAll('.btn-del-homeroom-stu').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const stu = state.students.find(s => s.id === id);
      if (!stu) return;
      if (!confirm(`[${stu.studentNo} ${stu.name}] 학생을 명단에서 삭제하시겠습니까?`)) return;

      state.students = state.students.filter(s => s.id !== id);
      delete state.attendance[id];
      if (state.basicInfos) delete state.basicInfos[id];
      state.counselings = state.counselings.filter(c => c.studentId !== id);
      saveState();
      renderAll();
    });
  });
}

function renderHomeroomCounselTable() {
  const tbody = document.getElementById('homeroom-counsel-tbody');
  if (!tbody) return;

  if (state.counselings.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="padding: 1.8rem; color: #6c757d;">
          아직 작성된 상담 내역이 없습니다. [상담관리] 메뉴에서 상담을 등록해보세요.
        </td>
      </tr>
    `;
    return;
  }

  const sorted = [...state.counselings].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  tbody.innerHTML = sorted.map(item => {
    const shortContent = item.content.length > 32 ? item.content.slice(0, 32) + '...' : item.content;
    return `
      <tr>
        <td>${escapeHtml(item.date)}</td>
        <td><strong>${escapeHtml(item.studentNo)}</strong></td>
        <td><strong>${escapeHtml(item.studentName)}</strong></td>
        <td style="text-align:left;">${escapeHtml(shortContent)}</td>
        <td>
          <div class="row-action-btns">
            <button class="btn btn-sky btn-view-homeroom-counsel" data-cid="${item.id}" style="padding:0.35rem 0.65rem; font-size:0.8rem;">
              내용보기
            </button>
            <button class="btn btn-yellow btn-dl-homeroom-counsel" data-cid="${item.id}" style="padding:0.35rem 0.65rem; font-size:0.8rem;">
              다운로드
            </button>
            <button class="btn-danger-sm btn-del-homeroom-counsel" data-cid="${item.id}">
              삭제
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.btn-view-homeroom-counsel').forEach(btn => {
    btn.addEventListener('click', () => {
      const cid = btn.getAttribute('data-cid');
      const item = state.counselings.find(c => c.id === cid);
      if (item) {
        // 기본자료와 상담내용이 한 페이지에 보이게 상세 모달 열기
        openStudentPersonalCounselModal(item.studentId);
      }
    });
  });

  tbody.querySelectorAll('.btn-dl-homeroom-counsel').forEach(btn => {
    btn.addEventListener('click', () => {
      const cid = btn.getAttribute('data-cid');
      const item = state.counselings.find(c => c.id === cid);
      if (item) downloadStudentPersonalWord(item.studentId);
    });
  });

  tbody.querySelectorAll('.btn-del-homeroom-counsel').forEach(btn => {
    btn.addEventListener('click', () => {
      const cid = btn.getAttribute('data-cid');
      if (!confirm('이 상담 기록을 삭제하시겠습니까?')) return;
      deleteCounselingRecord(cid);
    });
  });
}

function renderHomeroomAttendanceCareTable() {
  const tbody = document.getElementById('homeroom-care-tbody');
  if (!tbody) return;

  const targetStudents = state.students
    .map(stu => ({ stu, stats: calculateStudentAttendanceStats(stu.id) }))
    .filter(entry => entry.stats.hasAnyIssue);

  if (targetStudents.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="padding: 1.8rem; color: #6c757d;">
          현재 출결 특이사항(미인정결석, 기타결석, 연속5일, 누적35일)에 해당하는 학생이 없습니다.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = targetStudents.map(({ stu, stats }) => {
    const stuCounsels = state.counselings.filter(c => c.studentId === stu.id);
    const latestCounsel = stuCounsels[stuCounsels.length - 1];
    const summaryText = latestCounsel
      ? `[최근상담 ${latestCounsel.date}] ${latestCounsel.content}`
      : `상담 기록 없음 (총 0회)`;

    return `
      <tr>
        <td><strong>${escapeHtml(stu.studentNo)}</strong></td>
        <td><strong>${escapeHtml(stu.name)}</strong></td>
        <td>${renderStatsBadgesHtml(stats)}</td>
        <td style="text-align:left;">${escapeHtml(summaryText)}</td>
        <td>
          <div class="row-action-btns">
            <button class="btn btn-sky btn-care-homeroom-view" data-stuid="${stu.id}" style="padding:0.35rem 0.65rem; font-size:0.8rem;">
              내용보기
            </button>
            <button class="btn btn-yellow btn-care-homeroom-dl" data-stuid="${stu.id}" style="padding:0.35rem 0.65rem; font-size:0.8rem;">
              다운로드
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.btn-care-homeroom-view').forEach(btn => {
    btn.addEventListener('click', () => {
      const stuId = btn.getAttribute('data-stuid');
      // 기본자료와 상담내용이 한 페이지에 보이게 상세 모달 열기
      openStudentPersonalCounselModal(stuId);
    });
  });

  tbody.querySelectorAll('.btn-care-homeroom-dl').forEach(btn => {
    btn.addEventListener('click', () => {
      const stuId = btn.getAttribute('data-stuid');
      downloadStudentPersonalWord(stuId);
    });
  });
}

// -------------------- 5-4. [관리자] 렌더링 --------------------
function renderAdminSection() {
  renderAdminTeacherTable();
  renderAdminStudentsTable();
  renderAdminBasicSchemaPanel();
  renderAdminCounselTable();
  renderAdminAttendanceCareTable();
  renderAdminSupportTable();
}

// 관리자 0) [선생님(교사) 계정 관리] 표 렌더링 (행 추가, 교사명, 비번, 저장/수정/삭제)
function renderAdminTeacherTable() {
  const tbody = document.getElementById('admin-teacher-tbody');
  if (!tbody) return;

  if (!state.teachers || state.teachers.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="padding: 1.5rem; color: #6c757d;">
          등록된 선생님(교사) 계정이 없습니다. [+ 교사 계정 추가] 버튼을 눌러 교사명과 비밀번호를 등록하세요.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = state.teachers.map(tch => {
    const editing = Boolean(tch.isEditing);
    return `
      <tr data-admin-tch="${tch.id}">
        <td>
          <input
            type="text"
            class="admin-input inp-tch-name"
            value="${escapeHtml(tch.name)}"
            placeholder="교사명/아이디 입력 (예: 김선생)"
            ${editing ? '' : 'disabled'}
          />
        </td>
        <td>
          <input
            type="text"
            class="admin-input inp-tch-pw"
            value="${escapeHtml(tch.pw || TEACHER_DEFAULT_PASSWORD)}"
            placeholder="비밀번호 입력 (기본: yewon4441#)"
            ${editing ? '' : 'disabled'}
          />
        </td>
        <td>
          <input
            type="text"
            class="admin-input inp-tch-note"
            value="${escapeHtml(tch.note || '')}"
            placeholder="담당 학급 / 비고 (예: 1학년 1반)"
            ${editing ? '' : 'disabled'}
          />
        </td>
        <td>
          <div class="row-action-btns">
            <button class="btn btn-primary btn-save-tch" data-id="${tch.id}" style="padding:0.38rem 0.7rem; font-size:0.8rem;">
              저장
            </button>
            <button class="btn btn-outline-sm btn-edit-tch" data-id="${tch.id}">
              수정
            </button>
            <button class="btn-danger-sm btn-del-tch" data-id="${tch.id}">
              삭제
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // 저장 버튼
  tbody.querySelectorAll('.btn-save-tch').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const row = tbody.querySelector(`tr[data-admin-tch="${id}"]`);
      const nameVal = row.querySelector('.inp-tch-name').value.trim();
      const pwVal = row.querySelector('.inp-tch-pw').value.trim() || TEACHER_DEFAULT_PASSWORD;
      const noteVal = row.querySelector('.inp-tch-note').value.trim();

      if (!nameVal) {
        alert('선생님 아이디(교사명)를 입력해주세요.');
        return;
      }

      const tch = state.teachers.find(t => t.id === id);
      if (tch) {
        tch.name = nameVal;
        tch.pw = pwVal;
        tch.note = noteVal;
        tch.isEditing = false;

        // 계정별 데이터 초기화 (없는 경우 새로운 양식 생성)
        if (!state.accountsData) state.accountsData = {};
        if (!state.accountsData[id]) {
          state.accountsData[id] = createBlankAccountData(nameVal);
        }

        saveState();
        renderAdminTeacherTable();
        updateClassSwitcherOptions();
        alert(`[${nameVal}] 선생님 계정이 저장되었습니다.\n선생님 로그인에서 아이디: ${nameVal}, 비밀번호: ${pwVal}로 로그인할 수 있습니다.`);
      }
    });
  });

  // 수정 버튼
  tbody.querySelectorAll('.btn-edit-tch').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const tch = state.teachers.find(t => t.id === id);
      if (tch) {
        tch.isEditing = true;
        renderAdminTeacherTable();
        const row = tbody.querySelector(`tr[data-admin-tch="${id}"]`);
        if (row) row.querySelector('.inp-tch-name')?.focus();
      }
    });
  });

  // 삭제 버튼
  tbody.querySelectorAll('.btn-del-tch').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const tch = state.teachers.find(t => t.id === id);
      if (!tch) return;
      if (!confirm(`[${tch.name}] 선생님 계정을 삭제하시겠습니까?\n해당 계정의 출석부 및 상담 데이터도 함께 정리됩니다.`)) return;

      state.teachers = state.teachers.filter(t => t.id !== id);
      if (state.accountsData) delete state.accountsData[id];

      if (currentActiveAccountId === id) {
        applyActiveAccount('admin');
      }

      saveState();
      renderAll();
    });
  });
}

function renderAdminStudentsTable() {
  const tbody = document.getElementById('admin-student-tbody');
  if (!tbody) return;

  if (state.students.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="3" style="padding: 1.5rem; color: #6c757d;">
          [+ 행 추가] 버튼을 눌러 학번과 이름을 등록하세요.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = state.students.map(stu => {
    const editing = Boolean(stu.isEditing);
    return `
      <tr data-admin-stu="${stu.id}">
        <td>
          <input
            type="text"
            class="admin-input inp-stu-no"
            value="${escapeHtml(stu.studentNo)}"
            placeholder="학번 입력 (예: 10101)"
            ${editing ? '' : 'disabled'}
          />
        </td>
        <td>
          <input
            type="text"
            class="admin-input inp-stu-name"
            value="${escapeHtml(stu.name)}"
            placeholder="이름 입력 (예: 홍길동)"
            ${editing ? '' : 'disabled'}
          />
        </td>
        <td>
          <div class="row-action-btns">
            <button class="btn btn-primary btn-save-stu" data-id="${stu.id}" style="padding:0.38rem 0.7rem; font-size:0.8rem;">
              저장
            </button>
            <button class="btn btn-outline-sm btn-edit-stu" data-id="${stu.id}">
              수정
            </button>
            <button class="btn-danger-sm btn-del-stu" data-id="${stu.id}">
              삭제
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // 저장 버튼
  tbody.querySelectorAll('.btn-save-stu').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const row = tbody.querySelector(`tr[data-admin-stu="${id}"]`);
      const noVal = row.querySelector('.inp-stu-no').value.trim();
      const nameVal = row.querySelector('.inp-stu-name').value.trim();

      if (!noVal || !nameVal) {
        alert('학번과 이름을 모두 입력해주세요.');
        return;
      }

      const stu = state.students.find(s => s.id === id);
      if (stu) {
        stu.studentNo = noVal;
        stu.name = nameVal;
        stu.isEditing = false;

        // 상담 내역의 학번/이름도 동기화
        state.counselings.forEach(c => {
          if (c.studentId === id) {
            c.studentNo = noVal;
            c.studentName = nameVal;
          }
        });

        saveState();
        renderAll();
      }
    });
  });

  // 수정 버튼
  tbody.querySelectorAll('.btn-edit-stu').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const stu = state.students.find(s => s.id === id);
      if (stu) {
        stu.isEditing = true;
        renderAdminStudentsTable();
        const row = tbody.querySelector(`tr[data-admin-stu="${id}"]`);
        if (row) row.querySelector('.inp-stu-no').focus();
      }
    });
  });

  // 삭제 버튼
  tbody.querySelectorAll('.btn-del-stu').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const stu = state.students.find(s => s.id === id);
      if (!stu) return;
      if (!confirm(`[${stu.studentNo} ${stu.name}] 학생을 명단에서 삭제하시겠습니까?`)) return;

      state.students = state.students.filter(s => s.id !== id);
      delete state.attendance[id];
      if (state.basicInfos) delete state.basicInfos[id];
      state.counselings = state.counselings.filter(c => c.studentId !== id);
      saveState();
      renderAll();
    });
  });
}

// ============================================================================
// 관리자 2) [학생기본자료] 항목(중항목·소항목) 설정 패널 렌더링 & 제어
// ============================================================================
function renderAdminBasicSchemaPanel() {
  const container = document.getElementById('admin-basic-schema-container');
  if (!container) return;

  const schema = getBasicInfoSchema();

  if (schema.length === 0) {
    container.innerHTML = `
      <div style="padding:1.8rem; text-align:center; color:#868e96; background:#fff; border-radius:10px; border:1.5px dashed #ced4da;">
        등록된 학생기본자료 중항목이 없습니다.<br/>
        우측 상단의 <strong>[+ 중항목 추가]</strong>를 눌러 항목을 추가하거나 <strong>[기본 항목으로 초기화]</strong>를 눌러주세요.
      </div>
    `;
    return;
  }

  container.innerHTML = schema.map((cat, catIdx) => {
    const isFirst = catIdx === 0;
    const isLast = catIdx === schema.length - 1;

    const subitemsHtml = (cat.items || []).map((item, itemIdx) => `
      <span class="admin-subitem-badge" data-cat-idx="${catIdx}" data-item-idx="${itemIdx}">
        <span class="subitem-text" title="클릭하여 소항목 이름 수정">${escapeHtml(item)}</span>
        <button type="button" class="btn-subitem-edit" title="이름 수정">✏️</button>
        <button type="button" class="btn-subitem-del" title="삭제">×</button>
      </span>
    `).join('');

    return `
      <div class="admin-category-card" data-cat-idx="${catIdx}">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.6rem; border-bottom:1.5px solid #edf2f7; padding-bottom:0.6rem; margin-bottom:0.75rem;">
          <div style="display:flex; align-items:center; flex-wrap:wrap; gap:0.5rem;">
            <span style="font-weight:800; color:#7048e8; font-size:0.83rem; background:#f3f0ff; padding:0.25rem 0.55rem; border-radius:6px; border:1px solid #d0bfff;">
              중항목 ${catIdx + 1}
            </span>
            <input type="text" class="input-cat-name" value="${escapeHtml(cat.name)}" placeholder="중항목 이름 입력" 
                   style="font-weight:700; font-size:0.92rem; padding:0.35rem 0.65rem; border:1.5px solid #ced4da; border-radius:8px; width:200px;" />
            <select class="select-cat-type" style="padding:0.35rem 0.65rem; border:1.5px solid #ced4da; border-radius:8px; font-size:0.85rem; font-weight:600; background:#fff;">
              <option value="checkbox" ${cat.type === 'checkbox' ? 'selected' : ''}>다중 선택 (체크박스)</option>
              <option value="radio" ${cat.type === 'radio' ? 'selected' : ''}>단일 선택 (라디오)</option>
            </select>
            <label style="display:inline-flex; align-items:center; gap:0.3rem; font-size:0.84rem; font-weight:600; color:#495057; cursor:pointer;">
              <input type="checkbox" class="chk-cat-has-etc" ${cat.hasEtc ? 'checked' : ''} />
              기타(직접입력) 허용
            </label>
          </div>

          <div style="display:flex; align-items:center; gap:0.35rem;">
            <button type="button" class="btn btn-outline-sm btn-cat-up" data-idx="${catIdx}" title="위로 이동" ${isFirst ? 'disabled style="opacity:0.35; cursor:not-allowed;"' : ''}>
              ▲
            </button>
            <button type="button" class="btn btn-outline-sm btn-cat-down" data-idx="${catIdx}" title="아래로 이동" ${isLast ? 'disabled style="opacity:0.35; cursor:not-allowed;"' : ''}>
              ▼
            </button>
            <button type="button" class="btn btn-outline-sm btn-cat-del" data-idx="${catIdx}" title="중항목 삭제" style="color:#e03131; border-color:#ffa8a8; background:#fff5f5; font-weight:700;">
              🗑️ 삭제
            </button>
          </div>
        </div>

        <div>
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.45rem;">
            <span style="font-size:0.82rem; font-weight:700; color:#495057;">
              소항목 목록 (${cat.items ? cat.items.length : 0}개):
            </span>
            <span style="font-size:0.75rem; color:#868e96;">
              * 소항목 클릭(✏️) 시 이름 수정, × 클릭 시 삭제
            </span>
          </div>

          <div class="subitems-pill-container" style="display:flex; flex-wrap:wrap; gap:0.45rem; align-items:center;">
            ${subitemsHtml}
            <div style="display:inline-flex; align-items:center; gap:0.3rem;">
              <input type="text" class="input-new-subitem" data-cat-idx="${catIdx}" placeholder="새 소항목 입력" 
                     style="padding:0.25rem 0.6rem; border:1.5px solid #b197fc; border-radius:999px; font-size:0.82rem; width:130px; background:#fff;" />
              <button type="button" class="btn btn-outline-sm btn-add-subitem" data-cat-idx="${catIdx}" 
                      style="padding:0.25rem 0.65rem; border-radius:999px; font-size:0.78rem; background:#f3f0ff; color:#5f3dc4; border-color:#d0bfff; font-weight:700;">
                + 추가
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  bindAdminBasicSchemaEvents();
}

function syncSchemaFromDOM() {
  const container = document.getElementById('admin-basic-schema-container');
  if (!container) return;
  const schema = getBasicInfoSchema();
  const cards = container.querySelectorAll('.admin-category-card');
  cards.forEach((card, idx) => {
    if (schema[idx]) {
      const nameInp = card.querySelector('.input-cat-name');
      const typeSel = card.querySelector('.select-cat-type');
      const etcChk = card.querySelector('.chk-cat-has-etc');
      if (nameInp) schema[idx].name = nameInp.value.trim() || schema[idx].name;
      if (typeSel) schema[idx].type = typeSel.value;
      if (etcChk) schema[idx].hasEtc = etcChk.checked;
    }
  });
}

function bindAdminBasicSchemaEvents() {
  const container = document.getElementById('admin-basic-schema-container');
  if (!container) return;

  // 1) 중항목 위로 이동
  container.querySelectorAll('.btn-cat-up').forEach(btn => {
    btn.addEventListener('click', () => {
      syncSchemaFromDOM();
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      if (idx > 0) {
        const schema = getBasicInfoSchema();
        const temp = schema[idx];
        schema[idx] = schema[idx - 1];
        schema[idx - 1] = temp;
        renderAdminBasicSchemaPanel();
      }
    });
  });

  // 2) 중항목 아래로 이동
  container.querySelectorAll('.btn-cat-down').forEach(btn => {
    btn.addEventListener('click', () => {
      syncSchemaFromDOM();
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const schema = getBasicInfoSchema();
      if (idx < schema.length - 1) {
        const temp = schema[idx];
        schema[idx] = schema[idx + 1];
        schema[idx + 1] = temp;
        renderAdminBasicSchemaPanel();
      }
    });
  });

  // 3) 중항목 삭제
  container.querySelectorAll('.btn-cat-del').forEach(btn => {
    btn.addEventListener('click', () => {
      syncSchemaFromDOM();
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const schema = getBasicInfoSchema();
      const targetName = schema[idx] ? schema[idx].name : '해당';
      if (confirm(`'${targetName}' 중항목을 삭제하시겠습니까?\n(삭제 후 상단의 [항목 설정 저장]을 눌러야 영구 반영됩니다.)`)) {
        schema.splice(idx, 1);
        renderAdminBasicSchemaPanel();
      }
    });
  });

  // 4) 소항목 추가 버튼 & 엔터키
  const handleAddSubitem = (catIdx, inputEl) => {
    const val = inputEl.value.trim();
    if (!val) {
      inputEl.focus();
      return;
    }
    syncSchemaFromDOM();
    const schema = getBasicInfoSchema();
    if (schema[catIdx]) {
      if (!Array.isArray(schema[catIdx].items)) schema[catIdx].items = [];
      if (schema[catIdx].items.includes(val)) {
        alert(`'${val}' 소항목은 이미 존재합니다.`);
        inputEl.focus();
        return;
      }
      schema[catIdx].items.push(val);
      renderAdminBasicSchemaPanel();
      setTimeout(() => {
        const nextInp = document.querySelector(`.input-new-subitem[data-cat-idx="${catIdx}"]`);
        if (nextInp) nextInp.focus();
      }, 50);
    }
  };

  container.querySelectorAll('.btn-add-subitem').forEach(btn => {
    btn.addEventListener('click', () => {
      const catIdx = parseInt(btn.getAttribute('data-cat-idx'), 10);
      const card = btn.closest('.admin-category-card');
      const inputEl = card ? card.querySelector('.input-new-subitem') : null;
      if (inputEl) handleAddSubitem(catIdx, inputEl);
    });
  });

  container.querySelectorAll('.input-new-subitem').forEach(inp => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const catIdx = parseInt(inp.getAttribute('data-cat-idx'), 10);
        handleAddSubitem(catIdx, inp);
      }
    });
  });

  // 5) 소항목 수정 & 삭제
  const handleEditSubitem = (catIdx, itemIdx) => {
    syncSchemaFromDOM();
    const schema = getBasicInfoSchema();
    if (schema[catIdx] && schema[catIdx].items[itemIdx] !== undefined) {
      const cur = schema[catIdx].items[itemIdx];
      const next = prompt(`'${cur}' 소항목의 새 이름을 입력하세요:`, cur);
      if (next !== null) {
        const trimmed = next.trim();
        if (!trimmed) {
          alert('소항목 이름을 입력해주세요.');
          return;
        }
        schema[catIdx].items[itemIdx] = trimmed;
        renderAdminBasicSchemaPanel();
      }
    }
  };

  container.querySelectorAll('.admin-subitem-badge').forEach(badge => {
    const textSpan = badge.querySelector('.subitem-text');
    const editBtn = badge.querySelector('.btn-subitem-edit');
    const delBtn = badge.querySelector('.btn-subitem-del');
    const catIdx = parseInt(badge.getAttribute('data-cat-idx'), 10);
    const itemIdx = parseInt(badge.getAttribute('data-item-idx'), 10);

    if (textSpan) {
      textSpan.addEventListener('click', () => handleEditSubitem(catIdx, itemIdx));
    }
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleEditSubitem(catIdx, itemIdx);
      });
    }
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        syncSchemaFromDOM();
        const schema = getBasicInfoSchema();
        if (schema[catIdx] && schema[catIdx].items[itemIdx] !== undefined) {
          const itemVal = schema[catIdx].items[itemIdx];
          if (confirm(`'${itemVal}' 소항목을 삭제하시겠습니까?`)) {
            schema[catIdx].items.splice(itemIdx, 1);
            renderAdminBasicSchemaPanel();
          }
        }
      });
    }
  });
}

function initAdminBasicSchemaButtons() {
  const btnAddCat = document.getElementById('btn-add-basic-category');
  if (btnAddCat) {
    btnAddCat.addEventListener('click', () => {
      syncSchemaFromDOM();
      const schema = getBasicInfoSchema();
      const newId = 'cat_' + Date.now();
      schema.push({
        id: newId,
        name: '새 중항목',
        icon: '📌',
        type: 'checkbox',
        hasEtc: true,
        etcPlaceholder: '기타 내용을 직접 입력하세요...',
        items: ['항목 1', '항목 2']
      });
      renderAdminBasicSchemaPanel();
      setTimeout(() => {
        const lastCard = document.querySelector('.admin-category-card:last-child');
        if (lastCard) {
          const nameInp = lastCard.querySelector('.input-cat-name');
          if (nameInp) {
            nameInp.focus();
            nameInp.select();
          }
        }
      }, 50);
    });
  }

  const btnReset = document.getElementById('btn-reset-basic-schema');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (confirm('학생기본자료 항목을 초기 기본 항목(가정형태, 경제적 형편, 진로희망, 생활태도)으로 복원하시겠습니까?')) {
        state.basicInfoSchema = JSON.parse(JSON.stringify(DEFAULT_BASIC_INFO_SCHEMA));
        saveState();
        renderAdminBasicSchemaPanel();
        renderBasicInfoSection();
        alert('학생기본자료 항목이 초기 기본 항목으로 복원되었습니다.');
      }
    });
  }

  const btnSave = document.getElementById('btn-save-basic-schema');
  if (btnSave) {
    btnSave.addEventListener('click', () => {
      syncSchemaFromDOM();
      saveState();
      renderBasicInfoSection();
      alert('학생기본자료 항목(중항목, 소항목) 설정이 성공적으로 저장되었습니다!\n학생 기본자료 설정 화면 및 상담카드에 즉시 반영됩니다.');
    });
  }
}

function renderAdminCounselTable() {
  const tbody = document.getElementById('admin-counsel-tbody');
  if (!tbody) return;

  if (state.counselings.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="padding: 1.8rem; color: #6c757d;">
          아직 작성된 상담 내역이 없습니다. [상담관리] 메뉴에서 상담을 등록해보세요.
        </td>
      </tr>
    `;
    return;
  }

  // 날짜 순서대로 위에서 아래로 배열 (오름차순)
  const sorted = [...state.counselings].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  tbody.innerHTML = sorted.map(item => {
    const shortContent = item.content.length > 32 ? item.content.slice(0, 32) + '...' : item.content;
    return `
      <tr>
        <td>${escapeHtml(item.date)}</td>
        <td><strong>${escapeHtml(item.studentNo)}</strong></td>
        <td><strong>${escapeHtml(item.studentName)}</strong></td>
        <td style="text-align:left;">${escapeHtml(shortContent)}</td>
        <td>
          <div class="row-action-btns">
            <button class="btn btn-sky btn-view-counsel" data-cid="${item.id}" style="padding:0.35rem 0.65rem; font-size:0.8rem;">
              내용보기
            </button>
            <button class="btn btn-yellow btn-dl-counsel" data-cid="${item.id}" style="padding:0.35rem 0.65rem; font-size:0.8rem;">
              다운로드
            </button>
            <button class="btn-danger-sm btn-del-counsel" data-cid="${item.id}">
              삭제
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.btn-view-counsel').forEach(btn => {
    btn.addEventListener('click', () => {
      const cid = btn.getAttribute('data-cid');
      const item = state.counselings.find(c => c.id === cid);
      if (item) openStudentPersonalCounselModal(item.studentId);
    });
  });

  tbody.querySelectorAll('.btn-dl-counsel').forEach(btn => {
    btn.addEventListener('click', () => {
      const cid = btn.getAttribute('data-cid');
      const item = state.counselings.find(c => c.id === cid);
      if (item) downloadStudentPersonalWord(item.studentId);
    });
  });

  tbody.querySelectorAll('.btn-del-counsel').forEach(btn => {
    btn.addEventListener('click', () => {
      const cid = btn.getAttribute('data-cid');
      if (!confirm('이 상담 기록을 삭제하시겠습니까?')) return;
      deleteCounselingRecord(cid);
    });
  });
}

// 관리자 -> [출결관리] 버튼 클릭 시 노출되는 6~10열 해당 학생 전용 테이블
function renderAdminAttendanceCareTable() {
  const tbody = document.getElementById('admin-care-tbody');
  if (!tbody) return;

  // 출석부 6~10열에 해당하는 학생들만 필터링 (결석이 1일 이상 있거나 8,9,10열 경고 해당자)
  const targetStudents = state.students
    .map(stu => ({ stu, stats: calculateStudentAttendanceStats(stu.id) }))
    .filter(entry => entry.stats.hasAnyIssue);

  if (targetStudents.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="padding: 1.8rem; color: #6c757d;">
          현재 출결 특이사항(미인정결석, 기타결석, 연속5일, 누적35일)에 해당하는 학생이 없습니다.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = targetStudents.map(({ stu, stats }) => {
    const stuCounsels = state.counselings.filter(c => c.studentId === stu.id);
    const latestCounsel = stuCounsels[stuCounsels.length - 1];
    const summaryText = latestCounsel
      ? `[최근상담 ${latestCounsel.date}] ${latestCounsel.content}`
      : `상담 기록 없음 (총 0회)`;

    return `
      <tr>
        <td><strong>${escapeHtml(stu.studentNo)}</strong></td>
        <td><strong>${escapeHtml(stu.name)}</strong></td>
        <td>${renderStatsBadgesHtml(stats)}</td>
        <td style="text-align:left;">${escapeHtml(summaryText)}</td>
        <td>
          <div class="row-action-btns">
            <button class="btn btn-sky btn-care-view" data-stuid="${stu.id}" style="padding:0.35rem 0.65rem; font-size:0.8rem;">
              내용보기
            </button>
            <button class="btn btn-yellow btn-care-dl" data-stuid="${stu.id}" style="padding:0.35rem 0.65rem; font-size:0.8rem;">
              다운로드
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.btn-care-view').forEach(btn => {
    btn.addEventListener('click', () => {
      const stuId = btn.getAttribute('data-stuid');
      openStudentPersonalCounselModal(stuId);
    });
  });

  tbody.querySelectorAll('.btn-care-dl').forEach(btn => {
    btn.addEventListener('click', () => {
      const stuId = btn.getAttribute('data-stuid');
      downloadStudentPersonalWord(stuId);
    });
  });
}

function renderAdminSupportTable() {
  const tbody = document.getElementById('admin-support-tbody');
  if (!tbody) return;

  const links = state.supportLinks || [];
  if (links.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="padding: 1.6rem; color: #6c757d; text-align: center;">
          등록된 지원 기관 링크가 없습니다. 우측 상단의 <strong>[+ 기관 추가]</strong> 버튼을 눌러 기관명과 사이트 주소를 등록하세요.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = links.map(item => {
    const editing = Boolean(item.isEditing);
    const cleanUrl = normalizeUrl(item.url);
    if (editing) {
      return `
        <tr data-admin-sup="${item.id}">
          <td>
            <input
              type="text"
              class="inp-support-name"
              value="${escapeHtml(item.name)}"
              placeholder="기관명 입력 (예: 청소년상담복지센터)"
            />
          </td>
          <td>
            <input
              type="text"
              class="inp-support-url"
              value="${escapeHtml(item.url)}"
              placeholder="사이트 주소 입력 (예: www.kyci.or.kr)"
            />
          </td>
          <td>
            <input
              type="text"
              class="inp-support-desc"
              value="${escapeHtml(item.desc || '')}"
              placeholder="설명 또는 비고 입력 (선택)"
            />
          </td>
          <td>
            <div class="row-action-btns">
              <button class="btn btn-orange btn-save-sup" data-id="${item.id}" style="padding:0.38rem 0.7rem; font-size:0.8rem;">
                저장
              </button>
              <button class="btn btn-outline-sm btn-cancel-sup" data-id="${item.id}">
                취소
              </button>
            </div>
          </td>
        </tr>
      `;
    }

    return `
      <tr data-admin-sup="${item.id}">
        <td style="text-align:left;">
          <a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="support-table-link" title="새 창에서 열기">
            <strong>${escapeHtml(item.name)}</strong>
            <i data-lucide="external-link" style="width:13px;height:13px;"></i>
          </a>
        </td>
        <td style="text-align:left;">
          <a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" style="color:#1971c2; word-break:break-all;" title="새 창에서 열기">
            ${escapeHtml(item.url)}
          </a>
        </td>
        <td style="text-align:left; color:#495057;">
          ${escapeHtml(item.desc || '-')}
        </td>
        <td>
          <div class="row-action-btns">
            <button class="btn btn-outline-sm btn-edit-sup" data-id="${item.id}">
              수정
            </button>
            <button class="btn-danger-sm btn-del-sup" data-id="${item.id}">
              삭제
            </button>
            <button class="btn btn-sky btn-open-sup" data-url="${cleanUrl}" style="padding:0.38rem 0.7rem; font-size:0.8rem;">
              이동 ↗
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // 저장 버튼
  tbody.querySelectorAll('.btn-save-sup').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const row = tbody.querySelector(`tr[data-admin-sup="${id}"]`);
      if (!row) return;

      const nameVal = row.querySelector('.inp-support-name').value.trim();
      const urlVal = row.querySelector('.inp-support-url').value.trim();
      const descVal = row.querySelector('.inp-support-desc').value.trim();

      if (!nameVal || !urlVal) {
        alert('기관명과 사이트 주소를 모두 입력해주세요.');
        return;
      }

      const item = state.supportLinks.find(s => s.id === id);
      if (item) {
        item.name = nameVal;
        item.url = urlVal;
        item.desc = descVal;
        item.isEditing = false;
        saveState();
        renderAll();
      }
    });
  });

  // 취소 버튼
  tbody.querySelectorAll('.btn-cancel-sup').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const item = state.supportLinks.find(s => s.id === id);
      if (item) {
        if (!item.name && !item.url) {
          state.supportLinks = state.supportLinks.filter(s => s.id !== id);
        } else {
          item.isEditing = false;
        }
        renderAdminSupportTable();
        if (window.lucide) window.lucide.createIcons();
      }
    });
  });

  // 수정 버튼
  tbody.querySelectorAll('.btn-edit-sup').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const item = state.supportLinks.find(s => s.id === id);
      if (item) {
        item.isEditing = true;
        renderAdminSupportTable();
        const row = tbody.querySelector(`tr[data-admin-sup="${id}"]`);
        if (row) {
          const inp = row.querySelector('.inp-support-name');
          if (inp) inp.focus();
        }
        if (window.lucide) window.lucide.createIcons();
      }
    });
  });

  // 삭제 버튼
  tbody.querySelectorAll('.btn-del-sup').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const item = state.supportLinks.find(s => s.id === id);
      if (!item) return;
      if (!confirm(`[${item.name || '해당'}] 기관 링크를 삭제하시겠습니까?`)) return;

      state.supportLinks = state.supportLinks.filter(s => s.id !== id);
      saveState();
      renderAll();
    });
  });

  // 이동 ↗ 버튼
  tbody.querySelectorAll('.btn-open-sup').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-url');
      if (url && url !== '#') {
        window.open(url, '_blank');
      }
    });
  });

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// ============================================================================
// 6. 기본자료 모달, 상담 작성 모달 & 개인 상담내용 상세보기 모달
// ============================================================================
function updateGuidancePreview() {
  const formEl = document.getElementById('form-basic-info');
  if (!formEl) return [];
  const posList = Array.from(formEl.querySelectorAll('input[name="cat_attitudePositive"]:checked, input[name="attitudePositive"]:checked')).map(el => el.value);
  const negList = Array.from(formEl.querySelectorAll('input[name="cat_problemBehavior"]:checked, input[name="problemBehavior"]:checked')).map(el => el.value);
  const econEl = formEl.querySelector('input[name="cat_economicStatus"]:checked, input[name="economicStatus"]:checked');
  const econVal = econEl ? econEl.value : '';

  const tempInfo = {
    attitudePositive: posList,
    problemBehaviors: negList,
    economicStatus: econVal
  };
  const tags = calculateAutoGuidance(tempInfo);
  const tagContainer = document.getElementById('guidance-auto-tags');
  if (tagContainer) {
    if (tags.length === 0) {
      tagContainer.innerHTML = '<span style="color:#d9480f; font-size:0.82rem;">(체크 조건에 따라 [교내장학/외부장학 추천 대상, 심리상담센터 연계]가 자동 제안됩니다)</span>';
    } else {
      tagContainer.innerHTML = tags.map(t => `<span class="guidance-badge">${escapeHtml(t)}</span>`).join(' ');
    }
  }
  return tags;
}

// -------------------- 동적 [학생기본자료] 폼 렌더링 --------------------
function renderDynamicBasicInfoForm(studentId) {
  const container = document.getElementById('dynamic-basic-info-fields');
  if (!container) return;

  const schema = getBasicInfoSchema();
  const info = getStudentBasicInfo(studentId);

  let html = '';
  schema.forEach((cat) => {
    const { selected, etc } = getCategoryValues(info, cat.id);
    const isRadio = cat.type === 'radio';
    const hasEtc = !!cat.hasEtc;
    const isEtcChecked = selected.includes('기타');

    let titleHtml = '';
    if (cat.subHeader && cat.color) {
      titleHtml = `
        <label class="box-title">
          ${cat.icon || '📌'} ${escapeHtml(cat.name)} <small>(${isRadio ? '단일 선택' : '복수 선택 가능'})</small>
        </label>
        <div style="font-size:0.8rem; font-weight:700; color:${cat.color}; margin-bottom:0.35rem;">${escapeHtml(cat.subHeader)}</div>
      `;
    } else {
      titleHtml = `
        <label class="box-title">
          ${cat.icon || '📌'} ${escapeHtml(cat.name)} <small>(${isRadio ? '단일 선택' : '복수 선택 가능'})</small>
        </label>
      `;
    }

    const pillsHtml = (cat.items || []).map(item => {
      const isChecked = selected.includes(item);
      return `
        <label class="check-pill">
          <input type="${isRadio ? 'radio' : 'checkbox'}" 
                 name="cat_${cat.id}" 
                 value="${escapeHtml(item)}" 
                 ${isChecked ? 'checked' : ''} />
          <span>${escapeHtml(item)}</span>
        </label>
      `;
    }).join('');

    const etcPillHtml = hasEtc ? `
      <label class="check-pill">
        <input type="${isRadio ? 'radio' : 'checkbox'}" 
               name="cat_${cat.id}" 
               value="기타" 
               class="chk-cat-etc" 
               data-cat-id="${cat.id}" 
               ${isEtcChecked ? 'checked' : ''} />
        <span>기타(직접입력)</span>
      </label>
    ` : '';

    const etcInputHtml = hasEtc ? `
      <input type="text" 
             id="etc-input-${cat.id}" 
             class="etc-input ${isEtcChecked ? '' : 'hidden'}" 
             value="${escapeHtml(etc)}" 
             placeholder="${escapeHtml(cat.etcPlaceholder || '기타 내용을 직접 입력하세요...')}" />
    ` : '';

    html += `
      <div class="form-section-box" style="margin-bottom:0.8rem;" data-category-id="${cat.id}">
        ${titleHtml}
        <div class="checkbox-group">
          ${pillsHtml}
          ${etcPillHtml}
        </div>
        ${etcInputHtml}
      </div>
    `;
  });

  container.innerHTML = html;

  // 기타 체크박스/라디오 토글 이벤트 연결
  container.querySelectorAll('.chk-cat-etc').forEach(chk => {
    chk.addEventListener('change', () => {
      const catId = chk.getAttribute('data-cat-id');
      const inp = document.getElementById(`etc-input-${catId}`);
      if (inp) {
        inp.classList.toggle('hidden', !chk.checked);
        if (chk.checked) inp.focus();
      }
    });
  });

  // 라디오 버튼의 경우 다른 라디오 선택 시 기타 입력란 숨김 처리
  schema.filter(c => c.type === 'radio' && c.hasEtc).forEach(cat => {
    container.querySelectorAll(`input[name="cat_${cat.id}"]`).forEach(rad => {
      rad.addEventListener('change', () => {
        const inp = document.getElementById(`etc-input-${cat.id}`);
        if (inp) {
          const isEtc = (rad.value === '기타' && rad.checked);
          inp.classList.toggle('hidden', !isEtc);
        }
      });
    });
  });

  // 체크/라디오 변경 시 지도방안 자동 제안 실시간 갱신
  container.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      updateGuidancePreview();
    });
  });
}

// 상담 기록 완전 삭제 함수 (모든 메뉴 및 계정 동기화)
function deleteCounselingRecord(counselId) {
  if (!counselId) return;
  // 1. 활성 state.counselings에서 완전 제거
  state.counselings = (state.counselings || []).filter(c => c.id !== counselId);
  editingCounselIds.delete(counselId);
  tempCounselRows = tempCounselRows.filter(r => r.id !== counselId);

  // 2. accountsData 내 모든 계정(admin 및 등록된 교사 계정 전체)에서 해당 상담 ID 완전 제거
  if (state.accountsData && typeof state.accountsData === 'object') {
    Object.keys(state.accountsData).forEach(accId => {
      const acc = state.accountsData[accId];
      if (acc && Array.isArray(acc.counselings)) {
        acc.counselings = acc.counselings.filter(c => c.id !== counselId);
      }
    });
  }

  // 3. 로컬 저장 및 Firebase Firestore 동기화
  saveState();

  // 4. 출석부, 상담관리, 담임관리, 관리자 뷰 전체 즉각 재렌더링
  renderAll();
}

let currentBasicStudentId = null;
let currentCounselStudentId = null;
let tempCounselRows = [];
let editingCounselIds = new Set();

// -------------------- 학생 개인별 기본자료 완전 초기화 --------------------
function resetStudentBasicInfo(studentId, confirmPrompt = true) {
  const stu = state.students.find(s => s.id === studentId);
  if (!stu) return;

  if (confirmPrompt) {
    const ok = confirm(`[${stu.studentNo} ${stu.name}] 학생의 기본자료를 모두 초기화(다 지우기)하시겠습니까?\n\n• 체크된 모든 항목(가정형태, 진로희망, 생활태도 등)이 해제됩니다.\n• 직접 입력된 내용 및 지도방안이 삭제됩니다.\n• 수정 날짜 및 저장 이력이 모두 삭제됩니다.`);
    if (!ok) return;
  }

  // 1) state.basicInfos 에서 해당 학생 데이터 완전 제거
  if (state.basicInfos) {
    delete state.basicInfos[studentId];
  }
  // 2) state.basicInfoHistory 에서 해당 학생 이력 완전 제거
  if (state.basicInfoHistory) {
    delete state.basicInfoHistory[studentId];
  }
  // 3) accountsData 내 모든 계정의 basicInfos & basicInfoHistory 에서도 완전 제거
  if (state.accountsData && typeof state.accountsData === 'object') {
    Object.keys(state.accountsData).forEach(accId => {
      const acc = state.accountsData[accId];
      if (acc) {
        if (acc.basicInfos && acc.basicInfos[studentId]) {
          delete acc.basicInfos[studentId];
        }
        if (acc.basicInfoHistory && acc.basicInfoHistory[studentId]) {
          delete acc.basicInfoHistory[studentId];
        }
      }
    });
  }

  // 4) 로컬 저장 및 클라우드 동기화
  saveState();

  // 5) 만약 기본자료 모달이 열려 있고 현재 학생이면 폼 내용 즉시 재로딩
  const modal = document.getElementById('modal-student-basic-info');
  if (modal && !modal.classList.contains('hidden') && currentBasicStudentId === studentId) {
    loadStudentToBasicInfoModal(studentId);
  }

  // 6) 테이블 등 뷰 전체 즉각 재렌더링
  renderAll();

  if (window.lucide) {
    window.lucide.createIcons();
  }

  alert(`[${stu.studentNo} ${stu.name}] 학생의 기본자료가 성공적으로 초기화(전체 삭제)되었습니다.`);
}

// -------------------- 6-1. [학생기본자료] 모달 --------------------
function openBasicInfoModal(selectedStudentId = null) {
  if (state.students.length === 0) {
    alert('먼저 관리자 또는 담임관리 메뉴에서 학생 명단을 추가해주세요.');
    return;
  }

  const modal = document.getElementById('modal-student-basic-info');
  if (!modal) return;

  const targetId = selectedStudentId || state.students[0].id;
  currentBasicStudentId = targetId;

  // 학생 선택 드롭다운 채우기
  const selectEl = document.getElementById('basic-student-select');
  if (selectEl) {
    selectEl.innerHTML = state.students.map(s => `
      <option value="${s.id}" ${s.id === targetId ? 'selected' : ''}>
        ${escapeHtml(s.studentNo)} - ${escapeHtml(s.name)}
      </option>
    `).join('');
  }

  loadStudentToBasicInfoModal(targetId);
  modal.classList.remove('hidden');

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function loadStudentToBasicInfoModal(studentId) {
  currentBasicStudentId = studentId;
  const stu = state.students.find(s => s.id === studentId);
  if (!stu) return;

  // 상단 학생 정보 배너
  const numEl = document.getElementById('basic-display-num');
  const nameEl = document.getElementById('basic-display-name');
  if (numEl) numEl.textContent = stu.studentNo;
  if (nameEl) nameEl.textContent = stu.name;

  // 기본자료 불러오기
  const formEl = document.getElementById('form-basic-info');
  if (formEl) formEl.reset();

  const idInp = document.getElementById('basic-student-id');
  if (idInp) idInp.value = stu.id;

  const info = getStudentBasicInfo(stu.id);

  // 기본자료 수정 날짜 (컴퓨터 시스템 날짜를 기본값으로 세팅, 사용자가 언제든 변경 가능)
  const dateInp = document.getElementById('basic-info-date');
  if (dateInp) {
    dateInp.value = formatDateYMD(new Date());
  }
  const prevDateSpan = document.getElementById('basic-info-prev-date');
  if (prevDateSpan) {
    prevDateSpan.textContent = info.recordDate ? `(직전 저장일: ${info.recordDate})` : '(저장 이력 없음)';
  }

  // 출결사항 자동 반영
  const stats = calculateStudentAttendanceStats(stu.id);
  const summaryBox = document.getElementById('basic-info-attendance-summary');
  if (summaryBox) {
    let mealBadgesHtml = '';
    if (stats.mealEvents && stats.mealEvents.length > 0) {
      mealBadgesHtml = stats.mealEvents.map(e => {
        return e.type === 'STOP'
          ? `<span class="mini-badge" style="background:#fff3bf; color:#d90429; font-weight:800;">급식중단 (${e.dateStr})</span>`
          : `<span class="mini-badge" style="background:#ffffff; color:#1971c2; border:1px solid #a5d8ff; font-weight:800;">급식재개 (${e.dateStr})</span>`;
      }).join(' ');
    } else if (stats.mealDisplayType === 'BOTH') {
      mealBadgesHtml = `
        <span class="mini-badge" style="background:#fff3bf; color:#d90429; font-weight:800;">급식중단 (${stats.mealStopDateStr})</span>
        <span class="mini-badge" style="background:#ffffff; color:#1971c2; border:1px solid #a5d8ff; font-weight:800;">급식재개 (${stats.mealResumeDateStr})</span>
      `;
    } else if (stats.mealDisplayType === 'STOP') {
      mealBadgesHtml = `<span class="mini-badge" style="background:#fff3bf; color:#d90429; font-weight:800;">급식중단 (${stats.mealStopDateStr})</span>`;
    }

    summaryBox.innerHTML = `
      <div style="display:flex; flex-wrap:wrap; gap:0.45rem;">
        ${mealBadgesHtml}
        <span class="mini-badge a1">미인정(A): ${stats.countA1}일</span>
        <span class="mini-badge ${stats.isTotalAll50 ? 't50' : 'a2'}">모든결석(A+B): ${stats.totalAll}일 ${stats.isTotalAll50 ? '(50일 이상)' : ''}</span>
        <span class="mini-badge ${stats.isStreak5 ? 's5' : ''}">
          미인정 연속 5일: ${stats.isStreak5 ? `해당 (${stats.streak5DateStr || '-'})` : '미해당'}
        </span>
        <span class="mini-badge ${stats.isTotal35 ? 't35' : ''}">
          미인정 누적 35일: ${stats.isTotal35 ? `해당 (${stats.total35DateStr || '-'})` : '미해당'}
        </span>
      </div>
    `;
  }

  // 동적 중항목/소항목 폼 렌더링 및 학생 데이터 채우기
  renderDynamicBasicInfoForm(stu.id);

  // 6) 지도방안 자동 계산 및 커스텀 입력값 채우기
  const guidanceInput = document.getElementById('guidance-input');
  if (guidanceInput) {
    guidanceInput.value = info.guidanceCustom || '';
  }
  updateGuidancePreview();
}

// -------------------- 6-2. [상담기록] 모달 --------------------
function openCounselModal(selectedStudentId = null, addRowImmediately = false) {
  if (state.students.length === 0) {
    alert('먼저 관리자 또는 담임관리 메뉴에서 학생 명단을 추가해주세요.');
    return;
  }

  const modal = document.getElementById('modal-counsel-records');
  if (!modal) return;

  const targetId = selectedStudentId || state.students[0].id;
  currentCounselStudentId = targetId;
  tempCounselRows = [];
  editingCounselIds.clear();

  // 연속 5일 및 누적 35일 상담 마일스톤 자동 동기화
  syncMilestoneCounselingsForStudent(targetId);

  if (addRowImmediately) {
    tempCounselRows.push({
      id: 'temp-' + Date.now(),
      studentId: targetId,
      date: formatDateYMD(new Date()),
      content: '',
      isNew: true
    });
  }

  // 학생 선택 드롭다운 채우기
  const selectEl = document.getElementById('counsel-student-select');
  if (selectEl) {
    selectEl.innerHTML = state.students.map(s => `
      <option value="${s.id}" ${s.id === targetId ? 'selected' : ''}>
        ${escapeHtml(s.studentNo)} - ${escapeHtml(s.name)}
      </option>
    `).join('');
  }

  loadStudentToCounselModal(targetId);
  modal.classList.remove('hidden');

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function loadStudentToCounselModal(studentId) {
  currentCounselStudentId = studentId;
  const stu = state.students.find(s => s.id === studentId);
  if (!stu) return;

  // 상단 학생 정보 배너
  const numEl = document.getElementById('counsel-display-num');
  const nameEl = document.getElementById('counsel-display-name');
  if (numEl) numEl.textContent = stu.studentNo;
  if (nameEl) nameEl.textContent = stu.name;

  // 기본자료 요약 카드 렌더링 (한 페이지에서 기본자료 + 상담내용 동시 열람)
  renderCounselModalBasicInfo(studentId);

  // 상담 기록 테이블 렌더링
  renderCounselRecordsTable(studentId);
}

function renderCounselModalBasicInfo(studentId) {
  const box = document.getElementById('counsel-modal-basic-info-box');
  if (!box) return;

  const stu = state.students.find(s => s.id === studentId);
  if (!stu) {
    box.innerHTML = '';
    return;
  }

  const basic = getStudentBasicInfo(studentId);
  const stats = calculateStudentAttendanceStats(studentId);
  const schema = getBasicInfoSchema();

  const autoTags = (basic.guidanceAuto && basic.guidanceAuto.length > 0)
    ? basic.guidanceAuto
    : calculateAutoGuidance(basic);
  const guidanceDisplay = [
    ...autoTags.map(t => `[${t}]`),
    basic.guidanceCustom
  ].filter(Boolean).join(' ') || '해당 없음';

  const schemaItemsHtml = schema.map(cat => {
    const val = formatCategoryText(basic, cat);
    return `
      <div style="display:flex; gap:0.4rem; font-size:0.83rem; padding:0.25rem 0;">
        <span style="font-weight:700; color:#1971c2; min-width:85px; white-space:nowrap;">${escapeHtml(cat.name)}:</span>
        <span style="color:#333; font-weight:600;">${escapeHtml(val)}</span>
      </div>
    `;
  }).join('');

  box.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.6rem; border-bottom:1.5px solid #e7f5ff; padding-bottom:0.45rem;">
      <div style="display:flex; align-items:center; gap:0.4rem;">
        <span style="font-size:1.15rem;">📋</span>
        <h4 style="margin:0; font-size:0.98rem; color:#1971c2; font-weight:800;">학생 기본자료 (현재 최신 설정)</h4>
        <span style="font-size:0.78rem; color:#868e96; font-weight:600;">${basic.recordDate ? `(수정일: ${basic.recordDate})` : '(저장 이력 없음)'}</span>
      </div>
      <button type="button" class="btn btn-sky btn-open-basic-from-counsel" data-stu-id="${stu.id}" style="padding:0.28rem 0.65rem; font-size:0.8rem;">
        ✏️ 기본자료 설정/수정
      </button>
    </div>

    <!-- 출결 현황 미니 배지 -->
    <div style="margin-bottom:0.55rem;">
      <div style="font-size:0.8rem; font-weight:700; color:#495057; margin-bottom:0.25rem;">📊 출결사항 요약:</div>
      <div style="display:flex; flex-wrap:wrap; gap:0.35rem;">
        <span class="mini-badge a1">미인정(A): ${stats.countA1}일</span>
        <span class="mini-badge ${stats.isTotalAll50 ? 't50' : 'a2'}">모든결석(A+B): ${stats.totalAll}일 ${stats.isTotalAll50 ? '(50일 이상)' : ''}</span>
        <span class="mini-badge ${stats.isStreak5 ? 's5' : ''}">
          미인정 연속 5일: ${stats.isStreak5 ? `해당 (${stats.streak5DateStr || '-'})` : '미해당'}
        </span>
        <span class="mini-badge ${stats.isTotal35 ? 't35' : ''}">
          미인정 누적 35일: ${stats.isTotal35 ? `해당 (${stats.total35DateStr || '-'})` : '미해당'}
        </span>
      </div>
    </div>

    <!-- 기본 항목 그리드 -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:0.2rem 0.8rem; background:#fff; padding:0.6rem 0.8rem; border-radius:8px; border:1px solid #d0ebff;">
      ${schemaItemsHtml}
    </div>

    <!-- 지도방안 -->
    <div style="margin-top:0.5rem; background:#fff4e6; padding:0.45rem 0.75rem; border-radius:8px; border:1px solid #ffd8a8; font-size:0.83rem;">
      <span style="font-weight:800; color:#d9480f;">💡 [지도방안]:</span>
      <span style="color:#495057; font-weight:600; margin-left:0.3rem;">${escapeHtml(guidanceDisplay)}</span>
    </div>
  `;

  box.querySelector('.btn-open-basic-from-counsel')?.addEventListener('click', () => {
    openBasicInfoModal(stu.id);
  });
}

// 구버전 및 타 함수 호환용 래퍼
function loadStudentToUnifiedModal(studentId) {
  loadStudentToBasicInfoModal(studentId);
  loadStudentToCounselModal(studentId);
}

function renderUnifiedCounselingTable(studentId) {
  renderCounselRecordsTable(studentId);
}

// -------------------- 6-3. [상담기록] 테이블 렌더링 (날짜순 정렬, 빨간색 마일스톤) --------------------
function renderCounselRecordsTable(studentId) {
  const tbody = document.getElementById('counsel-records-tbody') || document.getElementById('unified-counsel-tbody');
  const countBadge = document.getElementById('counsel-count-badge') || document.getElementById('unified-counsel-count-badge');
  if (!tbody) return;

  // 연속 5일 및 누적 35일 동기화
  syncMilestoneCounselingsForStudent(studentId);

  // 날짜 순서대로 윗칸에서 아래칸으로 기록 (오름차순 정렬)
  const stuCounsels = state.counselings
    .filter(c => c.studentId === studentId)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  if (countBadge) {
    const writtenCount = stuCounsels.filter(c => (c.content || '').trim()).length;
    countBadge.textContent = `${writtenCount}회`;
  }

  // 기존 등록/마일스톤 상담 + 새로 추가 중인 임시 행 (아래칸에 배치)
  const allItems = [
    ...stuCounsels,
    ...tempCounselRows.filter(r => r.studentId === studentId)
  ];

  if (allItems.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="3" style="text-align:center; color:#888; padding:2rem;">
          등록된 상담 기록이 없습니다. 우측 상단의 <strong>[+ 새 상담 행 추가]</strong> 버튼을 눌러 상담을 입력하세요.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = allItems.map(item => {
    const isMilestone = Boolean(item.isMilestone);
    // 마일스톤인 경우 상담 내용이 비어있으면 즉시 작성할 수 있도록 입력창 기본 오픈
    const isEditing = Boolean(item.isNew || editingCounselIds.has(item.id) || (isMilestone && !(item.content || '').trim()));
    const rowClass = isMilestone ? 'row-milestone-red' : '';

    if (isEditing) {
      const dateCellHtml = isMilestone
        ? `
          <div class="milestone-date-red">${escapeHtml(item.date || '-')}</div>
          <span class="milestone-badge-tag">${escapeHtml(item.milestoneType || '미인정결석 특이사항')}</span>
          <input type="hidden" class="inp-row-date" value="${escapeHtml(item.date || '')}" />
        `
        : `
          <input
            type="date"
            class="inp-row-date"
            value="${escapeHtml(item.date || formatDateYMD(new Date()))}"
            style="padding:0.35rem 0.5rem; border:1.5px solid #2b8a3e; border-radius:6px; font-weight:700; color:#2b8a3e;"
            title="상담 날짜를 입력/선택하세요 (시스템 날짜 기본 세팅)"
          />
        `;

      const placeholderText = isMilestone
        ? `${item.milestoneType} 달성일 상담 내용을 바로 작성하고 [저장]하세요...`
        : '상담 내용을 입력하세요 (3줄 초과 시 자동 스크롤)...';

      return `
        <tr data-counsel-id="${item.id}" class="${rowClass}" style="background:#fffcfc;">
          <td style="text-align:center; vertical-align:middle;">
            ${dateCellHtml}
          </td>
          <td>
            <textarea
              class="inp-row-content"
              rows="3"
              placeholder="${escapeHtml(placeholderText)}"
              style="width:100%; padding:0.5rem 0.65rem; border:1.5px solid ${isMilestone ? '#d90429' : '#2b8a3e'}; border-radius:6px; font-family:inherit; font-size:0.88rem; resize:vertical; min-height:85px; line-height:1.5;"
            >${escapeHtml(item.content || '')}</textarea>
          </td>
          <td style="text-align:center; vertical-align:middle;">
            <div class="row-action-btns">
              <button type="button" class="btn btn-green btn-save-counsel-row" data-id="${item.id}" style="padding:0.35rem 0.65rem; font-size:0.82rem;">
                저장
              </button>
              <button type="button" class="btn btn-outline-sm btn-cancel-counsel-row" data-id="${item.id}" style="padding:0.35rem 0.65rem; font-size:0.82rem;">
                취소
              </button>
            </div>
          </td>
        </tr>
      `;
    }

    // 보기(View) 모드
    const dateCellHtml = isMilestone
      ? `
        <div class="milestone-date-red">${escapeHtml(item.date || '-')}</div>
        <span class="milestone-badge-tag">${escapeHtml(item.milestoneType || '미인정결석 특이사항')}</span>
      `
      : `
        <span style="font-weight:700; color:#1971c2;">${escapeHtml(item.date || '-')}</span>
      `;

    return `
      <tr data-counsel-id="${item.id}" class="${rowClass}">
        <td style="text-align:center; vertical-align:middle; background: ${isMilestone ? '#fff5f5' : '#fbfdff'};">
          ${dateCellHtml}
        </td>
        <td style="text-align:left; vertical-align:middle;">
          <div class="detail-content-scroll" style="white-space:pre-wrap; min-height:65px; max-height:240px; overflow-y:auto; line-height:1.6; padding:0.4rem 0.6rem; background:#fbfdff; border-radius:6px; border:1px solid #edf2f7;">${escapeHtml(item.content)}</div>
        </td>
        <td style="text-align:center; vertical-align:middle;">
          <div class="row-action-btns">
            <button type="button" class="btn btn-outline-sm btn-edit-counsel-row" data-id="${item.id}" style="padding:0.35rem 0.65rem; font-size:0.82rem;">
              수정
            </button>
            <button type="button" class="btn-danger-sm btn-del-counsel-row" data-id="${item.id}" style="padding:0.35rem 0.65rem; font-size:0.82rem;">
              삭제
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // 행 저장 버튼
  tbody.querySelectorAll('.btn-save-counsel-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const tr = tbody.querySelector(`tr[data-counsel-id="${id}"]`);
      if (!tr) return;

      const dateVal = tr.querySelector('.inp-row-date').value.trim();
      const contentVal = tr.querySelector('.inp-row-content').value.trim();

      if (!dateVal) {
        alert('상담 날짜를 입력 또는 선택해주세요.');
        tr.querySelector('.inp-row-date')?.focus();
        return;
      }
      if (!contentVal) {
        alert('상담 내용을 입력해주세요.');
        tr.querySelector('.inp-row-content').focus();
        return;
      }

      const stu = state.students.find(s => s.id === studentId);
      const isTemp = tempCounselRows.some(r => r.id === id);

      if (isTemp) {
        tempCounselRows = tempCounselRows.filter(r => r.id !== id);
        state.counselings.push({
          id: 'c-' + Date.now(),
          studentId: stu.id,
          studentNo: stu.studentNo,
          studentName: stu.name,
          date: dateVal,
          content: contentVal
        });
      } else {
        const item = state.counselings.find(c => c.id === id);
        if (item) {
          item.date = dateVal;
          item.content = contentVal;
        }
        editingCounselIds.delete(id);
      }

      saveState();
      renderAll();
      renderCounselRecordsTable(studentId);
    });
  });

  // 행 취소 버튼
  tbody.querySelectorAll('.btn-cancel-counsel-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      tempCounselRows = tempCounselRows.filter(r => r.id !== id);
      editingCounselIds.delete(id);
      renderCounselRecordsTable(studentId);
    });
  });

  // 행 수정 버튼
  tbody.querySelectorAll('.btn-edit-counsel-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      editingCounselIds.add(id);
      renderCounselRecordsTable(studentId);
      const tr = tbody.querySelector(`tr[data-counsel-id="${id}"]`);
      if (tr) tr.querySelector('.inp-row-content')?.focus();
    });
  });

  // 행 삭제 버튼
  tbody.querySelectorAll('.btn-del-counsel-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const item = state.counselings.find(c => c.id === id);
      if (!item) return;

      if (item.isMilestone) {
        if (!confirm(`[${item.milestoneType}] 상담 내용을 초기화하시겠습니까?\n(상담 기록란은 유지되며 입력칸이 비워집니다)`)) return;
        item.content = '';
        editingCounselIds.delete(id);
        saveState();
        renderAll();
        renderCounselRecordsTable(studentId);
        return;
      }

      if (!confirm('이 상담 기록을 삭제하시겠습니까?')) return;
      deleteCounselingRecord(id);
      renderCounselRecordsTable(studentId);
    });
  });
}

// 개인 상담내용 보기: 상단에 [기본자료] 노출하고 그 아래로 [기본자료 변동] 열과 [상담 내용]을 날짜별로 연달아 기록 표기
function openStudentPersonalCounselModal(studentId) {
  const stu = state.students.find(s => s.id === studentId);
  if (!stu) return;

  const stats = calculateStudentAttendanceStats(studentId);
  const basic = getStudentBasicInfo(studentId);

  // 상담 기록
  const stuCounsels = state.counselings
    .filter(c => c.studentId === studentId)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  // 기본자료 변동 이력 (처음 저장 이후 변동된 내역만 추출)
  const stuHistories = (state.basicInfoHistory && state.basicInfoHistory[studentId])
    ? state.basicInfoHistory[studentId]
    : [];

  const historyByDate = {};
  stuHistories.forEach(h => {
    if (!h.date) return;
    if (!historyByDate[h.date]) historyByDate[h.date] = [];
    const validChanges = Array.isArray(h.changes)
      ? h.changes.filter(ch => typeof ch === 'string' && (ch.includes('->') || ch.includes('선택') || ch.includes('해제') || ch.includes('제안')))
      : (typeof h.changesText === 'string' ? [h.changesText] : []);
    historyByDate[h.date].push(...validChanges);
  });

  // 유효한 변동사항이 없는 날짜 키 정리
  Object.keys(historyByDate).forEach(d => {
    if (historyByDate[d].length === 0) delete historyByDate[d];
  });

  const counselByDate = {};
  stuCounsels.forEach(c => {
    if (!c.date) return;
    if (!counselByDate[c.date]) counselByDate[c.date] = [];
    counselByDate[c.date].push(c.content);
  });

  // 상담 내용 또는 기본자료 변동이 존재하는 모든 날짜를 추출하여 행 생성 (날짜 자동설정으로 행 추가)
  const allDates = [...new Set([...Object.keys(counselByDate), ...Object.keys(historyByDate)])]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const modal = document.getElementById('modal-detail-view');
  const titleEl = document.getElementById('detail-modal-title');
  const bodyEl = document.getElementById('detail-modal-body');

  titleEl.textContent = `📄 개인 기본자료 및 상담 기록 (${stu.studentNo} ${stu.name})`;

  const counselsTimelineHtml = allDates.length === 0
    ? `<p style="color:#6c757d; padding:0.75rem 0;">등록된 상담 기록 및 기본자료 변동 이력이 없습니다.</p>`
    : `
      <div class="timeline-table-scroll-wrap">
        <table class="detail-table detail-timeline-table" style="table-layout: fixed; width: 100%;">
          <colgroup>
            <col class="col-date" style="width: 110px;" />
            <col class="col-changes" style="width: calc((100% - 110px) * 0.4);" />
            <col class="col-content" style="width: calc((100% - 110px) * 0.6);" />
          </colgroup>
          <thead>
            <tr>
              <th class="col-date" style="width:110px; text-align:center;">날짜</th>
              <th class="col-changes" style="width:calc((100% - 110px) * 0.4); text-align:left;">기본자료 변동</th>
              <th class="col-content" style="width:calc((100% - 110px) * 0.6); text-align:left;">상담 내용</th>
            </tr>
          </thead>
          <tbody>
            ${allDates.map(d => {
              const changes = historyByDate[d] || [];
              const contents = counselByDate[d] || [];
              const changesHtml = changes.length > 0
                ? changes.map(ch => `<div class="history-blue-text" style="color:#1971c2; font-weight:700;">${escapeHtml(ch)}</div>`).join('')
                : `<span style="color:#aaa;">-</span>`;
              const contentsHtml = contents.length > 0
                ? contents.map(content => `<div class="detail-content-scroll">${escapeHtml(content)}</div>`).join('<hr style="margin:8px 0; border:0; border-top:1px dashed #d0d7de;"/>')
                : `<div class="detail-content-empty">-</div>`;

              return `
                <tr>
                  <td class="col-date" style="text-align:center; font-weight:700; background:#fffdf5; vertical-align:top; word-break:break-all;">${escapeHtml(d)}</td>
                  <td class="col-changes" style="vertical-align:top; word-break:break-word;">${changesHtml}</td>
                  <td class="col-content" style="vertical-align:top; word-break:break-word;">${contentsHtml}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

  const autoTags = (basic.guidanceAuto && basic.guidanceAuto.length > 0)
    ? basic.guidanceAuto
    : calculateAutoGuidance(basic);
  const guidanceBadgesHtml = autoTags.map(t => `<span class="guidance-badge">${escapeHtml(t)}</span>`).join(' ');
  const guidanceCustomHtml = basic.guidanceCustom ? `<span>${escapeHtml(basic.guidanceCustom)}</span>` : '';
  const guidanceDisplay = (guidanceBadgesHtml || guidanceCustomHtml)
    ? `${guidanceBadgesHtml} ${guidanceCustomHtml}`
    : '<span style="color:#888;">(현재 조건에 해당하는 자동 제안 없음)</span>';

  bodyEl.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.4rem; background:#f8f9fa; padding:0.4rem 0.75rem; border-radius:8px; border:1px solid #dee2e6; margin-bottom:0.55rem;">
      <div style="font-size:0.85rem; color:#495057;">
        학생 <strong>${escapeHtml(stu.studentNo)} ${escapeHtml(stu.name)}</strong>의 최신 기본자료와 날짜별 상담 기록입니다.
      </div>
      <div style="display:flex; gap:0.35rem;">
        <button type="button" class="btn btn-sky" onclick="openBasicInfoModal('${stu.id}')" style="padding:0.25rem 0.6rem; font-size:0.78rem;">
          📋 기본자료 관리
        </button>
        <button type="button" class="btn btn-green" onclick="openCounselModal('${stu.id}')" style="padding:0.25rem 0.6rem; font-size:0.78rem;">
          💬 새 상담 작성/수정
        </button>
      </div>
    </div>

    <h4 style="margin-bottom:0.25rem; font-size:0.95rem; color:#d84b73;">📋 1. 학생 기본자료 (현재 최신 내용)</h4>
    <table class="detail-table detail-basic-table" style="margin-bottom: 0.6rem;">
      <tr>
        <th>학번 / 이름</th>
        <td><strong>${escapeHtml(stu.studentNo)}</strong> / <strong>${escapeHtml(stu.name)}</strong></td>
      </tr>
      <tr>
        <th>출결사항</th>
        <td>
          미인정(A): <strong>${stats.countA1}일</strong> |
          모든결석(A+B): <strong>${stats.totalAll}일</strong> (A: ${stats.countA1}일, B: ${stats.countA2}일) ${stats.isTotalAll50 ? '<span class="mini-badge t50">50일 이상 (주황색)</span>' : ''} |
          연속5일(A): <strong>${stats.isStreak5 ? `해당 (연속 ${stats.maxConsecutiveA1}일 - 노란색)` : '미해당'}</strong> |
          누적35일(A): <strong>${stats.isTotal35 ? '해당 (초록색)' : '미해당'}</strong>
        </td>
      </tr>
      ${getBasicInfoSchema().map(cat => `
        <tr>
          <th>${escapeHtml(cat.name)}</th>
          <td>${escapeHtml(formatCategoryText(basic, cat))}</td>
        </tr>
      `).join('')}
      <tr style="background:#fff4e6;">
        <th style="color:#d9480f;">💡 [지도방안]</th>
        <td>${guidanceDisplay}</td>
      </tr>
    </table>

    <h4 style="margin-bottom:0.3rem; font-size:0.95rem; color:#1e6091;">💬 2. 날짜별 기본자료 변동 및 상담 내용</h4>
    ${counselsTimelineHtml}
  `;

  activeDetailWordGenerator = () => downloadStudentPersonalWord(studentId);
  modal.classList.remove('hidden');
}

// ============================================================================
// 7. MS Word (.doc) 파일 생성 및 다운로드 기능
// ============================================================================
function triggerWordDownload(filename, bodyHtmlContent) {
  const fullHtml = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:w="urn:schemas-microsoft-com:office:word"
          xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(filename)}</title>
      <style>
        body { font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; color: #222; line-height: 1.5; }
        h1 { font-size: 16pt; color: #d84b73; border-bottom: 2px solid #ff8fab; padding-bottom: 6px; }
        h2 { font-size: 11.2pt; color: #1e6091; margin-top: 18px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 16px; }
        th, td { border: 1px solid #888; padding: 8px 10px; font-size: 8.4pt; text-align: left; }
        th { background-color: #fff6cc; font-weight: bold; width: 150px; }
        .badge-yellow { background-color: #ffea79; font-weight: bold; }
        .badge-green { background-color: #7bf1a8; font-weight: bold; }
        .badge-orange { background-color: #ffd8a8; color: #d9480f; font-weight: bold; }
        .badge-red { background-color: #ff8585; color: #7a0000; font-weight: bold; }
      </style>
    </head>
    <body>
      ${bodyHtmlContent}
    </body>
    </html>
  `;

  const blob = new Blob(['\ufeff', fullHtml], {
    type: 'application/msword;charset=utf-8'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.doc') ? filename : `${filename}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildStudentBasicInfoWordHtml(studentId) {
  const stu = state.students.find(s => s.id === studentId);
  if (!stu) return '';
  const stats = calculateStudentAttendanceStats(studentId);
  const basic = getStudentBasicInfo(studentId);

  const autoTags = (basic.guidanceAuto && basic.guidanceAuto.length > 0)
    ? basic.guidanceAuto
    : calculateAutoGuidance(basic);
  const guidanceDisplay = [
    ...autoTags.map(t => `[${t}]`),
    basic.guidanceCustom
  ].filter(Boolean).join(' ') || '해당 없음';

  return `
    <h1>내 금쪽이들 - 학생 기본자료 (${escapeHtml(stu.studentNo)} ${escapeHtml(stu.name)})</h1>
    <h2>1. 학생 기본자료 (현재 최신 내용)</h2>
    <table>
      <tr><th>학번 / 이름</th><td><strong>${escapeHtml(stu.studentNo)}</strong> / <strong>${escapeHtml(stu.name)}</strong></td></tr>
      <tr><th>기본자료 수정 날짜</th><td>${escapeHtml(basic.recordDate || '미지정')}</td></tr>
      <tr>
        <th>출결사항</th>
        <td>
          급식관리: ${stats.mealEvents && stats.mealEvents.length > 0 ? stats.mealEvents.map(e => {
            return e.type === 'STOP'
              ? `<span style="color:#d90429; font-weight:bold; background:#fff3bf; padding:2px 6px;">급식중단 (${e.dateStr})</span>`
              : `<span style="color:#1971c2; font-weight:bold; padding:2px 6px; border:1px solid #a5d8ff;">급식재개 (${e.dateStr})</span>`;
          }).join(' / ') : (stats.mealDisplayType === 'BOTH' ? `
            <span style="color:#d90429; font-weight:bold; background:#fff3bf; padding:2px 6px;">급식중단 (${stats.mealStopDateStr})</span> / 
            <span style="color:#1971c2; font-weight:bold; padding:2px 6px; border:1px solid #a5d8ff;">급식재개 (${stats.mealResumeDateStr})</span>
          ` : (stats.mealDisplayType === 'STOP' ? `
            <span style="color:#d90429; font-weight:bold; background:#fff3bf; padding:2px 6px;">급식중단 (${stats.mealStopDateStr})</span>
          ` : '해당 없음'))}<br/>
          미인정결석 관리 (연속 5일): ${stats.isStreak5 ? `<span style="background:#d3f9d8; font-weight:bold; padding:2px 6px;">미인정결석 연속 5일 (${stats.streak5DateStr || '-'})</span>` : '미해당'}<br/>
          미인정결석 관리 (누적 35일): ${stats.isTotal35 ? `<span style="background:#d0ebff; font-weight:bold; padding:2px 6px;">미인정결석 누적 35일 (${stats.total35DateStr || '-'})</span>` : `미해당 (현재 누적 ${stats.countA1}일)`}<br/>
          허용 결석일수 관리 (누적 50일): ${stats.isTotalAll50 ? '<span style="background:#ffd8a8; font-weight:bold; padding:2px 6px;">모든 결석 누적 50일</span>' : `미해당 (현재 누적 ${stats.totalAll}일)`}
        </td>
      </tr>
      ${getBasicInfoSchema().map(cat => `
        <tr><th>${escapeHtml(cat.name)}</th><td>${escapeHtml(formatCategoryText(basic, cat))}</td></tr>
      `).join('')}
      <tr style="background-color:#ffe8cc;">
        <th style="color:#d9480f;">💡 [지도방안]</th>
        <td><strong>${escapeHtml(guidanceDisplay)}</strong></td>
      </tr>
    </table>
  `;
}

function downloadStudentBasicInfoWord(studentId) {
  const stu = state.students.find(s => s.id === studentId);
  if (!stu) return;
  const html = buildStudentBasicInfoWordHtml(studentId);
  triggerWordDownload(`학생기본자료_${stu.studentNo}_${stu.name}.doc`, html);
}

// 개인 상담내용 내려받기(Word): 상단에 기본자료 노출하고 그 아래로 [기본자료 변동] 열과 [상담 내용]을 날짜별로 연달아 표기
function buildStudentPersonalWordHtml(studentId) {
  const stu = state.students.find(s => s.id === studentId);
  if (!stu) return '';
  const stats = calculateStudentAttendanceStats(studentId);
  const basic = getStudentBasicInfo(studentId);

  const stuCounsels = state.counselings
    .filter(c => c.studentId === studentId)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const stuHistories = (state.basicInfoHistory && state.basicInfoHistory[studentId])
    ? state.basicInfoHistory[studentId]
    : [];

  const historyByDate = {};
  stuHistories.forEach(h => {
    if (!h.date) return;
    if (!historyByDate[h.date]) historyByDate[h.date] = [];
    const validChanges = Array.isArray(h.changes)
      ? h.changes.filter(ch => typeof ch === 'string' && (ch.includes('->') || ch.includes('선택') || ch.includes('해제') || ch.includes('제안')))
      : (typeof h.changesText === 'string' ? [h.changesText] : []);
    historyByDate[h.date].push(...validChanges);
  });

  Object.keys(historyByDate).forEach(d => {
    if (historyByDate[d].length === 0) delete historyByDate[d];
  });

  const counselByDate = {};
  stuCounsels.forEach(c => {
    if (!c.date) return;
    if (!counselByDate[c.date]) counselByDate[c.date] = [];
    counselByDate[c.date].push(c.content);
  });

  // 상담 내용 또는 기본자료 변동이 존재하는 모든 날짜 추출
  const allDates = [...new Set([...Object.keys(counselByDate), ...Object.keys(historyByDate)])]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const counselsRowsHtml = allDates.length === 0
    ? `<tr><td colspan="3" style="text-align:center; color:#666; padding:12px;">등록된 상담 기록 및 기본자료 변동 이력이 없습니다.</td></tr>`
    : allDates.map(d => {
      const changes = historyByDate[d] || [];
      const contents = counselByDate[d] || [];
      const changesHtml = changes.length > 0
        ? changes.map(ch => `<div style="color:#1971c2; font-weight:bold;">${escapeHtml(ch)}</div>`).join('')
        : `<span style="color:#999;">-</span>`;
      const contentsHtml = contents.length > 0
        ? contents.map(c => `<div style="white-space:pre-wrap;">${escapeHtml(c)}</div>`).join('<hr style="margin:4px 0; border:0; border-top:1px dashed #ccc;"/>')
        : `<span style="color:#999;">-</span>`;

      const milestoneItem = stuCounsels.find(c => c.date === d && c.isMilestone);
      const dateHtml = milestoneItem
        ? `<div style="color:#d90429; font-weight:bold;">${escapeHtml(d)}</div><span style="display:inline-block; font-size:7.5pt; color:#c92a2a; background:#ffe3e3; border:1px solid #ffa8a8; padding:1px 4px; border-radius:3px;">[${escapeHtml(milestoneItem.milestoneType)}]</span>`
        : `<span style="font-weight:bold;">${escapeHtml(d)}</span>`;

      return `
        <tr>
          <td style="width:110px; text-align:center; background:#fffdf5; vertical-align:top;">${dateHtml}</td>
          <td style="vertical-align:top; width:36%;">${changesHtml}</td>
          <td style="vertical-align:top; width:54%;">${contentsHtml}</td>
        </tr>
      `;
    }).join('');

  const autoTags = (basic.guidanceAuto && basic.guidanceAuto.length > 0)
    ? basic.guidanceAuto
    : calculateAutoGuidance(basic);
  const guidanceDisplay = [
    ...autoTags.map(t => `[${t}]`),
    basic.guidanceCustom
  ].filter(Boolean).join(' ') || '해당 없음';

  return `
    <h1>내 금쪽이들 - 개인 상담기록부 (${escapeHtml(stu.studentNo)} ${escapeHtml(stu.name)})</h1>
    <h2>1. 학생 기본자료 (현재 최신 내용)</h2>
    <table>
      <tr><th>학번 / 이름</th><td><strong>${escapeHtml(stu.studentNo)}</strong> / <strong>${escapeHtml(stu.name)}</strong></td></tr>
      <tr>
        <th>출결사항</th>
        <td>
          급식관리: ${stats.mealEvents && stats.mealEvents.length > 0 ? stats.mealEvents.map(e => {
            return e.type === 'STOP'
              ? `<span style="color:#d90429; font-weight:bold; background:#fff3bf; padding:2px 6px;">급식중단 (${e.dateStr})</span>`
              : `<span style="color:#1971c2; font-weight:bold; padding:2px 6px; border:1px solid #a5d8ff;">급식재개 (${e.dateStr})</span>`;
          }).join(' / ') : (stats.mealDisplayType === 'BOTH' ? `
            <span style="color:#d90429; font-weight:bold; background:#fff3bf; padding:2px 6px;">급식중단 (${stats.mealStopDateStr})</span> / 
            <span style="color:#1971c2; font-weight:bold; padding:2px 6px; border:1px solid #a5d8ff;">급식재개 (${stats.mealResumeDateStr})</span>
          ` : (stats.mealDisplayType === 'STOP' ? `
            <span style="color:#d90429; font-weight:bold; background:#fff3bf; padding:2px 6px;">급식중단 (${stats.mealStopDateStr})</span>
          ` : '해당 없음'))}<br/>
          미인정결석 관리 (연속 5일): ${stats.isStreak5 ? `<span style="background:#d3f9d8; font-weight:bold; padding:2px 6px;">미인정결석 연속 5일 (${stats.streak5DateStr || '-'})</span>` : '미해당'}<br/>
          미인정결석 관리 (누적 35일): ${stats.isTotal35 ? `<span style="background:#d0ebff; font-weight:bold; padding:2px 6px;">미인정결석 누적 35일 (${stats.total35DateStr || '-'})</span>` : `미해당 (현재 누적 ${stats.countA1}일)`}<br/>
          허용 결석일수 관리 (누적 50일): ${stats.isTotalAll50 ? '<span style="background:#ffd8a8; font-weight:bold; padding:2px 6px;">모든 결석 누적 50일</span>' : `미해당 (현재 누적 ${stats.totalAll}일)`}
        </td>
      </tr>
      ${getBasicInfoSchema().map(cat => `
        <tr><th>${escapeHtml(cat.name)}</th><td>${escapeHtml(formatCategoryText(basic, cat))}</td></tr>
      `).join('')}
      <tr style="background-color:#ffe8cc;">
        <th style="color:#d9480f;">💡 [지도방안]</th>
        <td><strong>${escapeHtml(guidanceDisplay)}</strong></td>
      </tr>
    </table>

    <h2>2. 날짜별 상담 내용 및 기본자료 변동 (${allDates.length}건)</h2>
    <table style="width:100%; table-layout:fixed; border-collapse:collapse;">
      <colgroup>
        <col style="width: 110px;" />
        <col style="width: 36%;" />
        <col style="width: 54%;" />
      </colgroup>
      <thead>
        <tr>
          <th style="width:110px; text-align:center;">날짜</th>
          <th style="width:36%; text-align:left;">기본자료 변동</th>
          <th style="width:54%; text-align:left;">상담 내용</th>
        </tr>
      </thead>
      <tbody>
        ${counselsRowsHtml}
      </tbody>
    </table>
  `;
}

function downloadStudentPersonalWord(studentId) {
  const stu = state.students.find(s => s.id === studentId);
  if (!stu) return;
  const html = buildStudentPersonalWordHtml(studentId);
  triggerWordDownload(`상담기록부_${stu.studentNo}_${stu.name}.doc`, html);
}

function downloadAllCareWord() {
  const targets = state.students
    .map(stu => ({ stu, stats: calculateStudentAttendanceStats(stu.id) }))
    .filter(x => x.stats.hasAnyIssue);

  if (targets.length === 0) {
    alert('출결 특이사항에 해당하는 학생이 없습니다.');
    return;
  }

  const sections = targets.map(({ stu }) => buildStudentPersonalWordHtml(stu.id)).join('<hr style="margin:24px 0; border:0; border-top:2px dashed #ccc;" />');
  triggerWordDownload(`내금쪽이들_출결관리_전체현황_${formatDateYMD(new Date())}.doc`, sections);
}

// ============================================================================
// 8. Firebase 클라우드 실시간 연동 (선택적 설정)
// ============================================================================
async function initFirebaseIfConfigured() {
  const badge = document.getElementById('sync-status');
  let cfg = null;
  const raw = localStorage.getItem(FIREBASE_CONFIG_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      // 더미/예시 플레이스홀더 값이 아닐 때만 사용
      if (parsed.apiKey && !parsed.apiKey.includes('...') && parsed.projectId && !parsed.projectId.includes('...')) {
        cfg = parsed;
      }
    } catch (e) {}
  }

  // 로컬스토리지에 유효한 설정이 없으면 DEFAULT_FIREBASE_CONFIG 사용
  if (!cfg && DEFAULT_FIREBASE_CONFIG.apiKey && DEFAULT_FIREBASE_CONFIG.projectId) {
    cfg = { ...DEFAULT_FIREBASE_CONFIG };
    try {
      localStorage.setItem(FIREBASE_CONFIG_KEY, JSON.stringify(cfg));
    } catch (e) {}
  }

  if (!cfg || !cfg.apiKey || !cfg.projectId) {
    badge.textContent = '로컬 저장 모드';
    badge.className = 'sync-badge local';
    firestoreDb = null;
    return;
  }

  try {
    const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    const { getFirestore, doc, onSnapshot } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

    const app = getApps().length === 0 ? initializeApp(cfg) : getApps()[0];
    firestoreDb = getFirestore(app);

    badge.textContent = '☁️ Firebase 실시간 연동중';
    badge.className = 'sync-badge cloud';

    onSnapshot(doc(firestoreDb, 'appData', 'mainState'), (snap) => {
      // 로컬 쓰기로 인한 즉각적인 snapshot(hasPendingWrites: true)은 무시하여
      // 타이핑 도중 포커스가 풀리거나 입력한 내용이 덮어씌워지는 현상 원천 차단
      if (snap.metadata && snap.metadata.hasPendingWrites) {
        return;
      }
      if (snap.exists()) {
        const cloudData = snap.data();
        isSyncingFromCloud = true;

        if (Array.isArray(cloudData.teachers) && cloudData.teachers.length > 0) {
          state.teachers = cloudData.teachers;
        }

        if (cloudData.accountsData && typeof cloudData.accountsData === 'object') {
          state.accountsData = cloudData.accountsData;
        }

        if (Array.isArray(cloudData.basicInfoSchema) && cloudData.basicInfoSchema.length > 0) {
          state.basicInfoSchema = cloudData.basicInfoSchema;
        }

        // 레거시 호환: accountsData['admin']이 없을 때 탑레벨 데이터 복원
        if (!state.accountsData) state.accountsData = {};
        if (!state.accountsData['admin'] && (cloudData.students || cloudData.attendance)) {
          state.accountsData['admin'] = {
            students: cloudData.students || [],
            attendance: cloudData.attendance || {},
            holidays: cloudData.holidays || {},
            holidayReasons: cloudData.holidayReasons || {},
            basicInfos: cloudData.basicInfos || {},
            basicInfoHistory: cloudData.basicInfoHistory || {},
            counselings: cloudData.counselings || []
          };
        }

        // 출석 데이터 A, B 정규화
        Object.keys(state.accountsData).forEach(accId => {
          const acc = state.accountsData[accId];
          if (acc && acc.attendance) {
            Object.keys(acc.attendance).forEach(stuId => {
              Object.keys(acc.attendance[stuId] || {}).forEach(ymd => {
                const norm = normalizeAttendanceValue(acc.attendance[stuId][ymd]);
                if (norm === 'A' || norm === 'B') {
                  acc.attendance[stuId][ymd] = norm;
                } else if (!norm) {
                  delete acc.attendance[stuId][ymd];
                }
              });
            });
          }
        });

        // 현재 활성 계정에 최신 데이터 동기화
        if (state.accountsData[currentActiveAccountId]) {
          const acc = state.accountsData[currentActiveAccountId];
          state.students = acc.students || [];
          state.attendance = acc.attendance || {};
          state.holidays = acc.holidays || {};
          state.holidayReasons = acc.holidayReasons || {};
          state.basicInfos = acc.basicInfos || {};
          state.basicInfoHistory = acc.basicInfoHistory || {};
          state.counselings = acc.counselings || [];
        } else {
          state.students = cloudData.students || state.students;
          state.attendance = cloudData.attendance || state.attendance;
          state.holidays = cloudData.holidays || state.holidays;
          state.holidayReasons = cloudData.holidayReasons || state.holidayReasons;
          state.basicInfos = cloudData.basicInfos || state.basicInfos;
          state.basicInfoHistory = cloudData.basicInfoHistory || state.basicInfoHistory;
          state.counselings = cloudData.counselings || state.counselings;
        }

        purgeStreak5CounselingRecords();
        state.supportLinks = Array.isArray(cloudData.supportLinks) ? cloudData.supportLinks : state.supportLinks;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        renderAll();
        isSyncingFromCloud = false;
      } else {
        saveState();
      }
    }, (error) => {
      console.error('Firebase onSnapshot 오류 (권한/보안규칙 확인 필요):', error);
      badge.textContent = '⚠️ Firebase 보안규칙 확인 필요';
      badge.className = 'sync-badge local';
    });
  } catch (err) {
    console.error('Firebase 초기화 실패:', err);
    badge.textContent = 'Firebase 연결 오류 (로컬 모드)';
    badge.className = 'sync-badge local';
  }
}

// ============================================================================
// 9. 이벤트 리스너 및 로그인 제어 초기화
// ============================================================================
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function switchPage(targetId) {
  const sections = ['section-attendance', 'section-basic-info', 'section-counseling', 'section-support', 'section-homeroom', 'section-admin'];
  sections.forEach(id => {
    const sec = document.getElementById(id);
    if (sec) {
      sec.classList.toggle('hidden', id !== targetId);
    }
  });
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-target') === targetId);
  });
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function setLoggedInUI(isLoggedIn, account = null) {
  const loginView = document.getElementById('login-view');
  const appContent = document.getElementById('app-content');
  const mainNav = document.getElementById('main-nav');
  const adminInfo = document.getElementById('admin-user-info');
  const navBtnAdmin = document.getElementById('nav-btn-admin');
  const classSwitcherWrap = document.getElementById('class-switcher-wrap');
  const userRoleBadge = document.getElementById('user-role-badge');

  if (isLoggedIn) {
    loginView.classList.add('hidden');
    appContent.classList.remove('hidden');
    mainNav.classList.remove('hidden');
    adminInfo.classList.remove('hidden');

    const curAcc = account || getCurrentAccount() || { role: 'admin', id: 'admin', name: '예성원' };

    if (curAcc.role === 'admin') {
      if (userRoleBadge) {
        userRoleBadge.textContent = `👑 관리자 (${curAcc.name})`;
        userRoleBadge.style.background = 'var(--pastel-sky)';
        userRoleBadge.style.color = 'var(--pastel-sky-dark)';
      }
      if (navBtnAdmin) navBtnAdmin.classList.remove('hidden');
      if (classSwitcherWrap) classSwitcherWrap.classList.remove('hidden');
    } else {
      if (userRoleBadge) {
        userRoleBadge.textContent = `👩‍🏫 ${curAcc.name} 선생님 (${curAcc.note || '담임교사'})`;
        userRoleBadge.style.background = 'var(--pastel-green)';
        userRoleBadge.style.color = 'var(--pastel-green-dark)';
      }
      // 선생님 계정은 관리자 메뉴 숨김
      if (navBtnAdmin) navBtnAdmin.classList.add('hidden');
      if (classSwitcherWrap) classSwitcherWrap.classList.add('hidden');
    }

    applyActiveAccount(curAcc.id);
    switchPage('section-attendance');
    renderAll();
  } else {
    loginView.classList.remove('hidden');
    appContent.classList.add('hidden');
    mainNav.classList.add('hidden');
    adminInfo.classList.add('hidden');
  }
}

function loginAsAccount(account) {
  sessionStorage.setItem(SESSION_AUTH_KEY, 'true');
  sessionStorage.setItem(SESSION_CURRENT_ACCOUNT_KEY, JSON.stringify(account));
  setLoggedInUI(true, account);
}

document.addEventListener('DOMContentLoaded', () => {
  // 세션 로그인 복원
  const isLogged = sessionStorage.getItem(SESSION_AUTH_KEY) === 'true';
  const curAcc = getCurrentAccount();
  if (isLogged && curAcc) {
    applyActiveAccount(curAcc.id);
    setLoggedInUI(true, curAcc);
  } else {
    setLoggedInUI(false, null);
  }
  initFirebaseIfConfigured();

  // 로그인 검증 헬퍼 함수
  function checkAdminLogin(inputId, inputPw) {
    const normId = (inputId || '').trim().normalize('NFC').toLowerCase();
    const normPw = (inputPw || '').trim().normalize('NFC');
    const normPwLower = normPw.toLowerCase();

    const validIds = [
      ADMIN_CREDENTIALS.id.normalize('NFC').toLowerCase(),
      ...((ADMIN_CREDENTIALS.aliasIds || []).map(id => id.normalize('NFC').toLowerCase()))
    ];
    const isIdValid = validIds.includes(normId);

    // 관리자 비번은 오직 admin4441# 하나로만 로그인 가능
    const isPwValid = (normPw === ADMIN_CREDENTIALS.pw);

    return isIdValid && isPwValid;
  }

  function checkTeacherLogin(inputId, inputPw) {
    const normId = (inputId || '').trim().normalize('NFC').toLowerCase();
    const normPw = (inputPw || '').trim().normalize('NFC');
    const normPwLower = normPw.toLowerCase();

    return (state.teachers || []).find(t => {
      const tName = (t.name || '').trim().normalize('NFC').toLowerCase();
      const tId = (t.id || '').trim().normalize('NFC').toLowerCase();
      const idMatches = (tName === normId || tId === normId);

      const defaultPw = TEACHER_DEFAULT_PASSWORD.normalize('NFC');
      const teacherCustomPw = (t.pw || '').trim().normalize('NFC');
      const pwMatches = (normPw === defaultPw || normPwLower === defaultPw.toLowerCase() ||
                         normPw === 'yewon4441' ||
                         (teacherCustomPw && (normPw === teacherCustomPw || normPwLower === teacherCustomPw.toLowerCase())));
      return idMatches && pwMatches;
    });
  }

  // 1-A) 관리자 로그인 폼 처리
  const adminLoginForm = document.getElementById('admin-login-form');
  if (adminLoginForm) {
    adminLoginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const rawInputId = (document.getElementById('admin-login-id').value || '').trim();
      const rawInputPw = (document.getElementById('admin-login-pw').value || '').trim();
      const errEl = document.getElementById('admin-login-error');

      // 1) 관리자 일치 여부 확인
      if (checkAdminLogin(rawInputId, rawInputPw)) {
        if (errEl) errEl.classList.add('hidden');
        loginAsAccount({
          role: 'admin',
          id: 'admin',
          name: '예성원',
          note: '관리자'
        });
        return;
      }

      // 2) 관리자 칸에 선생님 계정을 입력한 경우 선생님으로 자동 로그인 처리
      const teacher = checkTeacherLogin(rawInputId, rawInputPw);
      if (teacher) {
        if (errEl) errEl.classList.add('hidden');
        loginAsAccount({
          role: 'teacher',
          id: teacher.id,
          name: teacher.name,
          note: teacher.note || '담임교사'
        });
        return;
      }

      if (errEl) errEl.classList.remove('hidden');
    });
  }

  // 1-B) 선생님(담임) 로그인 폼 처리
  const teacherLoginForm = document.getElementById('teacher-login-form');
  if (teacherLoginForm) {
    teacherLoginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const rawInputId = (document.getElementById('teacher-login-id').value || '').trim();
      const rawInputPw = (document.getElementById('teacher-login-pw').value || '').trim();
      const errEl = document.getElementById('teacher-login-error');

      // 1) 선생님 계정 확인
      const teacher = checkTeacherLogin(rawInputId, rawInputPw);
      if (teacher) {
        if (errEl) errEl.classList.add('hidden');
        loginAsAccount({
          role: 'teacher',
          id: teacher.id,
          name: teacher.name,
          note: teacher.note || '담임교사'
        });
        return;
      }

      // 2) 선생님 칸에 관리자 계정을 입력한 경우 관리자로 자동 로그인 처리
      if (checkAdminLogin(rawInputId, rawInputPw)) {
        if (errEl) errEl.classList.add('hidden');
        loginAsAccount({
          role: 'admin',
          id: 'admin',
          name: '예성원',
          note: '관리자'
        });
        return;
      }

      if (errEl) errEl.classList.remove('hidden');
    });
  }

  // 로그아웃 공통
  document.getElementById('btn-logout').addEventListener('click', () => {
    sessionStorage.removeItem(SESSION_AUTH_KEY);
    sessionStorage.removeItem(SESSION_CURRENT_ACCOUNT_KEY);
    if (adminLoginForm) adminLoginForm.reset();
    if (teacherLoginForm) teacherLoginForm.reset();
    setLoggedInUI(false, null);
  });

  // 상단 관리자 학급 전환 셀렉트 박스
  const classSelect = document.getElementById('select-active-class');
  if (classSelect) {
    classSelect.addEventListener('change', (e) => {
      const selectedId = e.target.value;
      applyActiveAccount(selectedId);
      renderAll();
    });
  }

  // 2) 상단 메뉴 클릭 시 한 페이지씩 보이는 형태 (탭 페이지 전환)
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      switchPage(targetId);
    });
  });

  // 3) 주간 출석부 좌우 화살표 이동
  document.getElementById('btn-prev-week').addEventListener('click', () => {
    currentMonday.setDate(currentMonday.getDate() - 7);
    renderAttendanceSection();
  });

  document.getElementById('btn-next-week').addEventListener('click', () => {
    currentMonday.setDate(currentMonday.getDate() + 7);
    renderAttendanceSection();
  });

  document.getElementById('btn-today-week').addEventListener('click', () => {
    currentMonday = getMondayOfDate(new Date());
    renderAttendanceSection();
  });

  // 4) 상담기록 -> [+ 상담 행 추가 / 새 상담 작성]
  const btnQuickCounsel = document.getElementById('btn-quick-counsel-row');
  if (btnQuickCounsel) {
    btnQuickCounsel.addEventListener('click', () => {
      openCounselModal(null, true);
    });
  }

  // 기본자료 모달 내 학생 변경 시 데이터 전환
  const basicStudentSelect = document.getElementById('basic-student-select');
  if (basicStudentSelect) {
    basicStudentSelect.addEventListener('change', (e) => {
      loadStudentToBasicInfoModal(e.target.value);
    });
  }

  // 상담기록 모달 내 학생 변경 시 데이터 전환
  const counselStudentSelect = document.getElementById('counsel-student-select');
  if (counselStudentSelect) {
    counselStudentSelect.addEventListener('change', (e) => {
      loadStudentToCounselModal(e.target.value);
    });
  }

  // 구버전 통합 셀렉트 박스 호환
  const unifiedStudentSelect = document.getElementById('unified-student-select');
  if (unifiedStudentSelect) {
    unifiedStudentSelect.addEventListener('change', (e) => {
      loadStudentToUnifiedModal(e.target.value);
    });
  }

  // 상담기록 모달 내 [+ 새 상담 행 추가] 버튼 (날짜 순서대로 아래칸에 추가)
  const btnAddCounselRow = document.getElementById('btn-add-counsel-entry-row');
  if (btnAddCounselRow) {
    btnAddCounselRow.addEventListener('click', () => {
      const targetStuId = currentCounselStudentId || currentUnifiedStudentId;
      if (!targetStuId) return;
      tempCounselRows.push({
        id: 'temp-' + Date.now(),
        studentId: targetStuId,
        date: formatDateYMD(new Date()),
        content: '',
        isNew: true
      });
      renderCounselRecordsTable(targetStuId);
      const rows = document.querySelectorAll('#counsel-records-tbody tr[data-counsel-id^="temp-"], #unified-counsel-tbody tr[data-counsel-id^="temp-"]');
      const lastRow = rows[rows.length - 1];
      if (lastRow) {
        lastRow.querySelector('.inp-row-date')?.focus();
      }
    });
  }

  // 기본자료 모달 내 Word 다운로드 버튼
  const btnBasicWord = document.getElementById('btn-basic-word-download');
  if (btnBasicWord) {
    btnBasicWord.addEventListener('click', () => {
      const stuId = currentBasicStudentId || currentUnifiedStudentId;
      if (stuId) {
        downloadStudentBasicInfoWord(stuId);
      }
    });
  }

  // 상담기록 모달 내 Word 다운로드 버튼
  const btnCounselWord = document.getElementById('btn-counsel-word-download');
  if (btnCounselWord) {
    btnCounselWord.addEventListener('click', () => {
      const stuId = currentCounselStudentId || currentUnifiedStudentId;
      if (stuId) {
        downloadStudentPersonalWord(stuId);
      }
    });
  }

  // 구버전 통합 Word 다운로드 버튼 호환
  const btnUnifiedWord = document.getElementById('btn-unified-word-download');
  if (btnUnifiedWord) {
    btnUnifiedWord.addEventListener('click', () => {
      const stuId = currentCounselStudentId || currentUnifiedStudentId;
      if (stuId) {
        downloadStudentPersonalWord(stuId);
      }
    });
  }

  // 기본자료 모달 내 기타(직접입력) 체크 토글 바인딩
  const setupEtcToggle = (chkId, inpId) => {
    const chk = document.getElementById(chkId);
    const inp = document.getElementById(inpId);
    if (!chk || !inp) return;
    chk.addEventListener('change', () => {
      inp.classList.toggle('hidden', !chk.checked);
      if (chk.checked) inp.focus();
    });
  };

  setupEtcToggle('chk-family-etc', 'family-etc-input');
  setupEtcToggle('chk-career-etc', 'career-etc-input');
  setupEtcToggle('chk-attitude-pos-etc', 'attitude-pos-etc-input');
  setupEtcToggle('chk-attitude-neg-etc', 'attitude-neg-etc-input');

  // 기본자료 모달 입력 변경 시 실시간 지도방안 미리보기 갱신
  const formBasicInfo = document.getElementById('form-basic-info');
  if (formBasicInfo) {
    formBasicInfo.addEventListener('change', () => {
      updateGuidancePreview();
    });
    formBasicInfo.addEventListener('input', () => {
      updateGuidancePreview();
    });
  }

  // 5) 날짜는 컴퓨터 시스템 따르지 말고, 기본자료 수정하는 날짜와 저장 버튼 따로 설정
  const handleSaveBasicInfo = () => {
    const stuId = currentBasicStudentId || currentUnifiedStudentId || document.getElementById('basic-student-id')?.value;
    if (!stuId) return;

    const stu = state.students.find(s => s.id === stuId);
    if (!stu) return;

    const formEl = document.getElementById('form-basic-info');
    const oldInfo = getStudentBasicInfo(stuId);
    const schema = getBasicInfoSchema();

    const diffList = [];
    const newCustomValues = { ...(oldInfo.customValues || {}) };

    let newFamilyTypes = [];
    let newFamilyEtc = '';
    let newEconomicStatus = '중';
    let newCareerHopes = [];
    let newCareerEtc = '';
    let newAttitudePositive = [];
    let newAttitudePosEtc = '';
    let newProblemBehaviors = [];
    let newAttitudeNegEtc = '';

    schema.forEach(cat => {
      const checkedEls = Array.from(formEl.querySelectorAll(`input[name="cat_${cat.id}"]:checked`));
      const selectedValues = checkedEls.map(el => el.value);

      const chkEtc = formEl.querySelector(`.chk-cat-etc[data-cat-id="${cat.id}"]`);
      const inpEtc = document.getElementById(`etc-input-${cat.id}`);
      const etcVal = (chkEtc && chkEtc.checked && inpEtc) ? inpEtc.value.trim() : '';

      // 이전 값과 비교
      const oldVal = getCategoryValues(oldInfo, cat.id);
      const oldFormatted = oldVal.selected.map(x => (x === '기타' && oldVal.etc) ? `기타(${oldVal.etc})` : x);
      const newFormatted = selectedValues.map(x => (x === '기타' && etcVal) ? `기타(${etcVal})` : x);

      if (cat.type === 'radio') {
        const oldChoice = oldFormatted[0] || '';
        const newChoice = newFormatted[0] || '';
        if (oldChoice && oldChoice !== newChoice) {
          diffList.push(`${cat.name}: ${oldChoice} -> ${newChoice}`);
        } else if (!oldChoice && newChoice) {
          diffList.push(`${cat.name}: ${newChoice} 선택`);
        }
      } else {
        const removed = oldFormatted.filter(x => !newFormatted.includes(x));
        const added = newFormatted.filter(x => !oldFormatted.includes(x));
        if (removed.length === 1 && added.length === 1) {
          diffList.push(`${cat.name}: ${removed[0]} -> ${added[0]}`);
        } else {
          removed.forEach(item => diffList.push(`${cat.name}: ${item} -> 해제`));
          added.forEach(item => diffList.push(`${cat.name}: ${item} -> 선택`));
        }
      }

      // 표준 필드 및 커스텀 필드 매핑
      if (cat.id === 'familyType') {
        newFamilyTypes = selectedValues;
        newFamilyEtc = etcVal;
      } else if (cat.id === 'economicStatus') {
        newEconomicStatus = selectedValues[0] || '';
      } else if (cat.id === 'careerHope') {
        newCareerHopes = selectedValues;
        newCareerEtc = etcVal;
      } else if (cat.id === 'attitudePositive') {
        newAttitudePositive = selectedValues;
        newAttitudePosEtc = etcVal;
      } else if (cat.id === 'problemBehavior') {
        newProblemBehaviors = selectedValues;
        newAttitudeNegEtc = etcVal;
      } else {
        newCustomValues[cat.id] = {
          selected: selectedValues,
          etc: etcVal
        };
      }
    });

    const newGuidanceAuto = calculateAutoGuidance({
      attitudePositive: newAttitudePositive,
      problemBehaviors: newProblemBehaviors,
      economicStatus: newEconomicStatus
    });
    const guidanceInput = document.getElementById('guidance-input');
    const guidanceCustom = guidanceInput ? guidanceInput.value.trim() : '';

    // 기본자료 수정 날짜 (컴퓨터 시스템 날짜 기본 세팅 및 사용자 직접 변경값 반영)
    const dateInp = document.getElementById('basic-info-date');
    const recordDate = (dateInp && dateInp.value) ? dateInp.value.trim() : formatDateYMD(new Date());

    // 지도방안 변동
    const oldGuide = oldInfo.guidanceAuto || [];
    const removedGuide = oldGuide.filter(x => !newGuidanceAuto.includes(x));
    const addedGuide = newGuidanceAuto.filter(x => !oldGuide.includes(x));
    removedGuide.forEach(item => diffList.push(`지도방안: ${item} -> 해제`));
    addedGuide.forEach(item => diffList.push(`지도방안: ${item} -> 제안`));
    if (oldInfo.guidanceCustom !== guidanceCustom && (oldInfo.guidanceCustom || guidanceCustom)) {
      diffList.push(`지도방안(직접): ${oldInfo.guidanceCustom || '없음'} -> ${guidanceCustom || '없음'}`);
    }

    // 기본자료 처음 저장 여부 판별 (기존 저장된 recordDate가 없거나 데이터가 비어있는 경우)
    const isFirstSave = !state.basicInfos || !state.basicInfos[stuId] || !state.basicInfos[stuId].recordDate;

    // 기본자료 처음 저장한 이후, 그 다음부터 변동한 것은 날짜 자동설정해서 행을 만들고 기본자료변동란에 파란색으로 기재
    if (isFirstSave) {
      // 처음 등록/저장 시에는 변동 이력(diff) 행을 생성하지 않고 기본자료 초기값으로만 저장
      if (state.basicInfoHistory && state.basicInfoHistory[stuId]) {
        delete state.basicInfoHistory[stuId];
      }
    } else {
      // 처음 저장 이후 변동이 발생한 경우에만 날짜 자동설정하여 이력에 기록
      if (diffList.length > 0 && recordDate) {
        if (!state.basicInfoHistory) state.basicInfoHistory = {};
        if (!state.basicInfoHistory[stuId]) state.basicInfoHistory[stuId] = [];
        const existingHistory = state.basicInfoHistory[stuId].find(h => h.date === recordDate);
        if (existingHistory) {
          if (!Array.isArray(existingHistory.changes)) existingHistory.changes = [];
          existingHistory.changes = [...new Set([...existingHistory.changes, ...diffList])];
        } else {
          state.basicInfoHistory[stuId].push({
            date: recordDate,
            changes: diffList
          });
        }
      }
    }

    if (!state.basicInfos) state.basicInfos = {};
    state.basicInfos[stuId] = {
      recordDate,
      familyTypes: newFamilyTypes,
      familyEtc: newFamilyEtc,
      economicStatus: newEconomicStatus,
      careerHopes: newCareerHopes,
      careerEtc: newCareerEtc,
      attitudePositive: newAttitudePositive,
      attitudePosEtc: newAttitudePosEtc,
      problemBehaviors: newProblemBehaviors,
      attitudeNegEtc: newAttitudeNegEtc,
      guidanceAuto: newGuidanceAuto,
      guidanceCustom,
      customValues: newCustomValues
    };

    saveState();
    renderAll();
    alert(`[${stu.studentNo} ${stu.name}] 학생의 기본자료가 성공적으로 저장되었습니다!`);
  };

  const btnSaveBasic = document.getElementById('btn-save-basic-info');
  if (btnSaveBasic) {
    btnSaveBasic.addEventListener('click', handleSaveBasicInfo);
  }

  const btnResetSingleBasic = document.getElementById('btn-reset-single-basic-info');
  if (btnResetSingleBasic) {
    btnResetSingleBasic.addEventListener('click', () => {
      const stuId = currentBasicStudentId;
      if (stuId) {
        resetStudentBasicInfo(stuId);
      }
    });
  }

  const formBasic = document.getElementById('form-basic-info');
  if (formBasic) {
    formBasic.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSaveBasicInfo();
    });
  }

  // 5) 관리자 -> [출석부] 행 추가 버튼
  document.getElementById('btn-add-student-row').addEventListener('click', () => {
    const newId = 'stu-' + Date.now();
    state.students.push({
      id: newId,
      studentNo: '',
      name: '',
      isEditing: true
    });
    renderAdminStudentsTable();
    renderHomeroomStudentsTable();
    const row = document.querySelector(`tr[data-admin-stu="${newId}"]`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.querySelector('.inp-stu-no')?.focus();
    }
  });

  // 5-B) 담임관리 -> [출석부] 행 추가 버튼
  const btnHomeroomAddStu = document.getElementById('btn-homeroom-add-student-row');
  if (btnHomeroomAddStu) {
    btnHomeroomAddStu.addEventListener('click', () => {
      const newId = 'stu-' + Date.now();
      state.students.push({
        id: newId,
        studentNo: '',
        name: '',
        isEditing: true
      });
      renderHomeroomStudentsTable();
      renderAdminStudentsTable();
      const row = document.querySelector(`tr[data-homeroom-stu="${newId}"]`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.querySelector('.inp-stu-no')?.focus();
      }
    });
  }

  // 5-C) 관리자 -> [선생님(교사) 계정] 행 추가 버튼
  const btnAddTeacher = document.getElementById('btn-add-teacher-row');
  if (btnAddTeacher) {
    btnAddTeacher.addEventListener('click', () => {
      const newId = 'tch-' + Date.now();
      if (!state.teachers) state.teachers = [];
      state.teachers.push({
        id: newId,
        name: '',
        pw: TEACHER_DEFAULT_PASSWORD,
        note: '',
        isEditing: true
      });
      renderAdminTeacherTable();
      const row = document.querySelector(`tr[data-admin-tch="${newId}"]`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.querySelector('.inp-tch-name')?.focus();
      }
    });
  }

  // 5-D) 관리자 -> [지원] 기관 행 추가 버튼
  const btnAddSup = document.getElementById('btn-add-support-row');
  if (btnAddSup) {
    btnAddSup.addEventListener('click', () => {
      const newId = 'sup-' + Date.now();
      if (!state.supportLinks) state.supportLinks = [];
      state.supportLinks.push({
        id: newId,
        name: '',
        url: '',
        desc: '',
        isEditing: true
      });
      renderAdminSupportTable();
      if (window.lucide) window.lucide.createIcons();
      const row = document.querySelector(`tr[data-admin-sup="${newId}"]`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const inp = row.querySelector('.inp-support-name');
        if (inp) inp.focus();
      }
    });
  }

  // 5-E) 관리자 -> [학생기본자료] 항목(중항목·소항목) 설정 버튼 초기화
  initAdminBasicSchemaButtons();

  // 6) 관리자 -> [출결관리] 뷰 토글 및 전체 다운로드
  const careView = document.getElementById('admin-attendance-care-view');
  const counselListView = document.getElementById('admin-counsel-list-view');

  document.getElementById('btn-toggle-attendance-care').addEventListener('click', () => {
    const showingCare = !careView.classList.contains('hidden');
    if (showingCare) {
      careView.classList.add('hidden');
      counselListView.classList.remove('hidden');
    } else {
      careView.classList.remove('hidden');
      counselListView.classList.add('hidden');
      renderAdminAttendanceCareTable();
    }
  });

  document.getElementById('btn-close-care-view').addEventListener('click', () => {
    careView.classList.add('hidden');
    counselListView.classList.remove('hidden');
  });

  document.getElementById('btn-download-care-all').addEventListener('click', () => {
    downloadAllCareWord();
  });

  document.getElementById('btn-download-all-counsel').addEventListener('click', () => {
    if (state.counselings.length === 0) {
      alert('다운로드할 상담 내역이 없습니다.');
      return;
    }
    const studentIdsWithCounsel = [...new Set(state.counselings.map(c => c.studentId))];
    const sectionsHtml = studentIdsWithCounsel
      .map(stuId => buildStudentPersonalWordHtml(stuId))
      .join('<hr style="margin:24px 0; border:0; border-top:2px dashed #ccc;" />');

    triggerWordDownload(`내금쪽이들_전체상담내역_${formatDateYMD(new Date())}.doc`, sectionsHtml);
  });

  // 6-B) 담임관리 -> [출결관리] 뷰 토글 및 전체 다운로드
  const homeroomCareView = document.getElementById('homeroom-attendance-care-view');
  const homeroomCounselListView = document.getElementById('homeroom-counsel-list-view');
  const btnHomeroomToggleCare = document.getElementById('btn-homeroom-toggle-attendance-care');
  if (btnHomeroomToggleCare && homeroomCareView && homeroomCounselListView) {
    btnHomeroomToggleCare.addEventListener('click', () => {
      const showingCare = !homeroomCareView.classList.contains('hidden');
      if (showingCare) {
        homeroomCareView.classList.add('hidden');
        homeroomCounselListView.classList.remove('hidden');
      } else {
        homeroomCareView.classList.remove('hidden');
        homeroomCounselListView.classList.add('hidden');
        renderHomeroomAttendanceCareTable();
      }
    });
  }

  const btnHomeroomCloseCare = document.getElementById('btn-homeroom-close-care-view');
  if (btnHomeroomCloseCare && homeroomCareView && homeroomCounselListView) {
    btnHomeroomCloseCare.addEventListener('click', () => {
      homeroomCareView.classList.add('hidden');
      homeroomCounselListView.classList.remove('hidden');
    });
  }

  const btnHomeroomDlCareAll = document.getElementById('btn-homeroom-download-care-all');
  if (btnHomeroomDlCareAll) {
    btnHomeroomDlCareAll.addEventListener('click', () => {
      downloadAllCareWord();
    });
  }

  const btnHomeroomDlCounselAll = document.getElementById('btn-homeroom-download-all-counsel');
  if (btnHomeroomDlCounselAll) {
    btnHomeroomDlCounselAll.addEventListener('click', () => {
      if (state.counselings.length === 0) {
        alert('다운로드할 상담 내역이 없습니다.');
        return;
      }
      const studentIdsWithCounsel = [...new Set(state.counselings.map(c => c.studentId))];
      const sectionsHtml = studentIdsWithCounsel
        .map(stuId => buildStudentPersonalWordHtml(stuId))
        .join('<hr style="margin:24px 0; border:0; border-top:2px dashed #ccc;" />');

      triggerWordDownload(`내금쪽이들_학급상담내역_${formatDateYMD(new Date())}.doc`, sectionsHtml);
    });
  }

  // 상세 모달 내 Word 다운로드 버튼
  document.getElementById('btn-modal-word-download').addEventListener('click', () => {
    if (typeof activeDetailWordGenerator === 'function') {
      activeDetailWordGenerator();
    }
  });

  // 6-C) 전체 데이터 백업 저장 (.json 파일 다운로드 - 교사 계정 및 계정별 독립 데이터 포함)
  document.getElementById('btn-backup-data').addEventListener('click', () => {
    syncCurrentToAccountData();
    const backupData = {
      app: '내 금쪽이들',
      version: '2.0',
      exportedAt: new Date().toISOString(),
      teachers: state.teachers || [],
      accountsData: state.accountsData || {},
      supportLinks: state.supportLinks || [],
      basicInfoSchema: state.basicInfoSchema || DEFAULT_BASIC_INFO_SCHEMA
    };

    const jsonStr = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `내금쪽이들_전체데이터_백업_${formatDateYMD(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    alert('전체 데이터 백업 파일이 다운로드되었습니다!\n선생님 계정 정보와 각 학급별 출석부·상담 데이터가 모두 안전하게 포함되어 있습니다.');
  });

  // 6-D) 데이터 복원 / 불러오기 (.json 파일 선택)
  const inpRestore = document.getElementById('inp-restore-file');
  document.getElementById('btn-restore-data').addEventListener('click', () => {
    inpRestore.click();
  });

  inpRestore.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (!parsed.accountsData && !parsed.students && !parsed.attendance && !parsed.counselings) {
          alert('올바른 [내 금쪽이들] 백업 파일(.json)이 아닙니다.');
          return;
        }

        if (!confirm('백업 파일의 데이터를 불러오시겠습니까?\n모든 교사 계정과 출결·상담 데이터가 백업 내용으로 복원됩니다.')) {
          inpRestore.value = '';
          return;
        }

        if (Array.isArray(parsed.teachers)) state.teachers = parsed.teachers;
        if (Array.isArray(parsed.basicInfoSchema) && parsed.basicInfoSchema.length > 0) {
          state.basicInfoSchema = parsed.basicInfoSchema;
        }
        if (parsed.accountsData) {
          state.accountsData = parsed.accountsData;
        } else {
          // 구버전 백업 파일 호환 복원
          if (!state.accountsData) state.accountsData = {};
          state.accountsData['admin'] = {
            students: Array.isArray(parsed.students) ? parsed.students : [],
            attendance: parsed.attendance || {},
            holidays: parsed.holidays || {},
            holidayReasons: parsed.holidayReasons || {},
            basicInfos: parsed.basicInfos || {},
            basicInfoHistory: parsed.basicInfoHistory || {},
            counselings: Array.isArray(parsed.counselings) ? parsed.counselings : []
          };
        }
        if (Array.isArray(parsed.supportLinks)) state.supportLinks = parsed.supportLinks;

        applyActiveAccount(currentActiveAccountId);
        saveState();
        renderAll();
        alert('데이터 복원이 성공적으로 완료되었습니다!');
      } catch (err) {
        alert('파일을 읽는 중 오류가 발생했습니다: ' + err.message);
      } finally {
        inpRestore.value = '';
      }
    };
    reader.readAsText(file, 'UTF-8');
  });

  // 7) Firebase 연동 설정 모달
  document.getElementById('btn-open-firebase-modal').addEventListener('click', () => {
    let cfg = null;
    const raw = localStorage.getItem(FIREBASE_CONFIG_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.apiKey && !parsed.apiKey.includes('...')) {
          cfg = parsed;
        }
      } catch (e) {}
    }
    if (!cfg) cfg = DEFAULT_FIREBASE_CONFIG;

    document.getElementById('fb-api-key').value = cfg.apiKey || '';
    document.getElementById('fb-project-id').value = cfg.projectId || '';
    document.getElementById('fb-app-id').value = cfg.appId || '';

    const rawInp = document.getElementById('fb-raw-config-input');
    if (rawInp) rawInp.value = '';
    document.getElementById('modal-firebase-config').classList.remove('hidden');
  });

  // Firebase 설정 코드 전체 붙여넣기 시 자동 추출/완성
  const rawConfigInput = document.getElementById('fb-raw-config-input');
  if (rawConfigInput) {
    rawConfigInput.addEventListener('input', (e) => {
      const text = e.target.value.trim();
      if (!text) return;

      const extractVal = (key) => {
        const regex = new RegExp(`['"]?${key}['"]?\\s*:\\s*['"]([^'"]+)['"]`, 'i');
        const m = text.match(regex);
        return m ? m[1].trim() : '';
      };

      const apiKey = extractVal('apiKey');
      const projectId = extractVal('projectId');
      const appId = extractVal('appId');

      if (apiKey) document.getElementById('fb-api-key').value = apiKey;
      if (projectId) document.getElementById('fb-project-id').value = projectId;
      if (appId) document.getElementById('fb-app-id').value = appId;
    });
  }

  document.getElementById('btn-save-firebase').addEventListener('click', () => {
    const apiKey = document.getElementById('fb-api-key').value.trim();
    const projectId = document.getElementById('fb-project-id').value.trim();
    const appId = document.getElementById('fb-app-id').value.trim();

    if (!apiKey || !projectId) {
      alert('API Key와 Project ID를 입력해주세요.');
      return;
    }

    const cfg = {
      apiKey,
      authDomain: `${projectId}.firebaseapp.com`,
      projectId,
      appId
    };
    localStorage.setItem(FIREBASE_CONFIG_KEY, JSON.stringify(cfg));
    document.getElementById('modal-firebase-config').classList.add('hidden');
    initFirebaseIfConfigured();
    saveState();
  });

  document.getElementById('btn-clear-firebase').addEventListener('click', () => {
    localStorage.removeItem(FIREBASE_CONFIG_KEY);
    document.getElementById('modal-firebase-config').classList.add('hidden');
    initFirebaseIfConfigured();
  });

  // 모달 닫기 공통
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-close');
      document.getElementById(target).classList.add('hidden');
    });
  });
});
