/**
 * 내 금쪽이들 - 학교 출결 및 상담 관리 웹앱
 * - 관리자 계정 설정 (아이디/비밀번호 변경 시 안티그래비티를 통해 ADMIN_CREDENTIALS 수정)
 * - 주간 출석부 (월~금, 휴업일 체크, A1/A2 입력, 6~10열 자동 계산 및 색상 경고)
 * - 상담관리 및 상담카드 모달 (10줄 스크롤, 3줄 상담내용 스크롤)
 * - 관리자 메뉴 (학생 추가/저장/수정/삭제, 상담내역 Word 다운로드, 출결관리 6~10열 필터링)
 * - Firebase Firestore 실시간 연동 + LocalStorage 자동 백업
 */

// ============================================================================
// 1. 관리자 로그인 정보 (변경 시 안티그래비티로 수정)
// ============================================================================
const ADMIN_CREDENTIALS = {
  id: '예성원',
  pw: '8797'
};

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
      { id: 'tch-1', name: '김선생', pw: '1234', note: '1학년 1반', isEditing: false },
      { id: 'tch-2', name: '이선생', pw: '1234', note: '1학년 2반', isEditing: false }
    ],
    accountsData: {
      'admin': adminAccountData,
      'tch-1': sampleTeacher1Data,
      'tch-2': sampleTeacher2Data
    },
    supportLinks: [],
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

let state = loadStateFromLocal();
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

    // 2) 등록된 각 교사별 accountsData가 없으면 기본 양식 생성
    teachers.forEach(tch => {
      if (!accountsData[tch.id]) {
        accountsData[tch.id] = initial.accountsData[tch.id] || createBlankAccountData(tch.name);
      }
    });

    const currentAcc = getCurrentAccount();
    const targetAccountId = (currentAcc && accountsData[currentAcc.id]) ? currentAcc.id : 'admin';
    currentActiveAccountId = targetAccountId;

    const activeAcc = accountsData[targetAccountId];

    return {
      teachers,
      accountsData,
      supportLinks: Array.isArray(parsed.supportLinks) ? parsed.supportLinks : [],
      students: activeAcc.students || [],
      attendance: activeAcc.attendance || {},
      holidays: activeAcc.holidays || {},
      holidayReasons: activeAcc.holidayReasons || {},
      basicInfos: activeAcc.basicInfos || {},
      basicInfoHistory: activeAcc.basicInfoHistory || {},
      counselings: activeAcc.counselings || []
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
// 4. 출결 통계 계산 엔진
// - 미인정결석 누적(A)
// - 모든 결석 누적(A+B)
// - 연속5일: 미인정결석(A) 연속 5일 이상 (토·일, 공휴일, 휴업일 앞뒤 연결) -> 노란색
// - 누적35일: 미인정결석(A) 누적 35일 이상 -> 초록색
// ============================================================================
function calculateStudentAttendanceStats(studentId) {
  const stuRecords = state.attendance[studentId] || {};
  const recordedDates = Object.keys(stuRecords).sort();

  let countA1 = 0;
  let countA2 = 0;

  for (const ymd of recordedDates) {
    // 휴업일로 지정된 날짜는 결석 집계에서 제외
    if (state.holidays && state.holidays[ymd]) continue;
    const val = normalizeAttendanceValue(stuRecords[ymd]);
    if (val === 'A') countA1++;
    else if (val === 'B') countA2++;
  }

  // 연속 미인정결석(A) 최대 일수 계산 (주말·공휴일·휴업일은 건너뛰며 앞뒤 연결)
  let maxConsecutiveA1 = 0;
  const a1Dates = recordedDates.filter(ymd => {
    if (state.holidays && state.holidays[ymd]) return false;
    const mark = normalizeAttendanceValue(stuRecords[ymd]);
    return mark === 'A';
  });

  if (a1Dates.length > 0) {
    const startParts = a1Dates[0].split('-').map(Number);
    const endParts = a1Dates[a1Dates.length - 1].split('-').map(Number);
    const cur = new Date(startParts[0], startParts[1] - 1, startParts[2]);
    const end = new Date(endParts[0], endParts[1] - 1, endParts[2]);

    let currentStreak = 0;
    while (cur <= end) {
      const ymd = formatDateYMD(cur);
      if (isNonSchoolDay(ymd)) {
        // 토·일, 공휴일, 휴업일은 스트릭을 끊지 않고 앞뒤로 그대로 연결
      } else {
        const mark = normalizeAttendanceValue(stuRecords[ymd]);
        if (mark === 'A') {
          currentStreak++;
          if (currentStreak > maxConsecutiveA1) {
            maxConsecutiveA1 = currentStreak;
          }
        } else {
          currentStreak = 0;
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
  }

  const totalAll = countA1 + countA2;
  const isStreak5 = maxConsecutiveA1 >= 5;
  const isTotal35 = countA1 >= 35;
  const isTotalAll50 = totalAll >= 50; // 모든 결석(A+B) 50일 이상 (주황색)

  // 특이사항이 있는지 여부 ([출결관리] 필터용)
  const hasAnyIssue = countA1 > 0 || totalAll > 0 || isStreak5 || isTotal35 || isTotalAll50;

  return {
    countA1,          // 미인정결석 누적(A)
    countA2,
    totalAll,         // 모든 결석 누적(A+B)
    maxConsecutiveA1,
    isStreak5,        // 연속 5일 이상(노란색)
    isTotal35,        // 누적 35일 이상(초록색)
    isTotalAll50,     // 모든 결석 50일 이상(주황색)
    hasAnyIssue
  };
}

// ============================================================================
// 5. 화면 렌더링 함수들
// ============================================================================
function renderAll() {
  renderAttendanceSection();
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

  // 월~금 5개 요일 헤더 + 휴업일 체크박스 + 공휴일/휴업 사유 또는 행사명 입력칸 업데이트
  const dayThs = document.querySelectorAll('#attendance-thead-row th.col-day');
  weekDays.forEach((dayInfo, idx) => {
    const th = dayThs[idx];
    if (!th) return;
    const isHoliday = Boolean(state.holidays[dayInfo.ymd]);
    const holidayReason = state.holidayReasons?.[dayInfo.ymd] || '';
    th.classList.toggle('is-holiday-col', isHoliday);
    th.innerHTML = `
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
    const stats = calculateStudentAttendanceStats(stu.id);

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
        <td class="col-6-a1"><strong>${stats.countA1}</strong>일</td>
        <td class="col-7-all ${stats.isTotalAll50 ? 'cell-total-all50-active' : ''}"><strong>${stats.totalAll}</strong>일</td>
        <td class="col-8-streak5 ${stats.isStreak5 ? 'cell-streak5-active' : ''}">
          ${stats.isStreak5 ? `⚠️ 해당 (연속 ${stats.maxConsecutiveA1}일)` : `${stats.maxConsecutiveA1 > 0 ? `연속 ${stats.maxConsecutiveA1}일` : '-'}`}
        </td>
        <td class="col-9-total35 ${stats.isTotal35 ? 'cell-total35-active' : ''}">
          ${stats.isTotal35 ? `✅ 해당 (${stats.countA1}일)` : '-'}
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

// 입력 중 포커스를 유지하기 위해 해당 행의 누적/통계만 즉시 업데이트
function updateSingleStudentRowStats(stuId) {
  const row = document.querySelector(`tr[data-row-stu="${stuId}"]`);
  if (!row) return;
  const stats = calculateStudentAttendanceStats(stuId);

  const c6 = row.querySelector('.col-6-a1');
  const c7 = row.querySelector('.col-7-all');
  const c8 = row.querySelector('.col-8-streak5');
  const c9 = row.querySelector('.col-9-total35');

  if (c6) c6.innerHTML = `<strong>${stats.countA1}</strong>일`;
  if (c7) {
    c7.className = `col-7-all ${stats.isTotalAll50 ? 'cell-total-all50-active' : ''}`;
    c7.innerHTML = `<strong>${stats.totalAll}</strong>일`;
  }
  if (c8) {
    c8.className = `col-8-streak5 ${stats.isStreak5 ? 'cell-streak5-active' : ''}`;
    c8.textContent = stats.isStreak5 ? `⚠️ 해당 (연속 ${stats.maxConsecutiveA1}일)` : (stats.maxConsecutiveA1 > 0 ? `연속 ${stats.maxConsecutiveA1}일` : '-');
  }
  if (c9) {
    c9.className = `col-9-total35 ${stats.isTotal35 ? 'cell-total35-active' : ''}`;
    c9.textContent = stats.isTotal35 ? `✅ 해당 (${stats.countA1}일)` : '-';
  }
}

// 학생별 기본자료 조회 헬퍼
function getStudentBasicInfo(studentId) {
  if (!state.basicInfos) state.basicInfos = {};
  const raw = state.basicInfos[studentId] || {};
  return {
    familyTypes: Array.isArray(raw.familyTypes) ? raw.familyTypes : [],
    familyEtc: raw.familyEtc || '',
    economicStatus: raw.economicStatus || '중',
    careerHopes: Array.isArray(raw.careerHopes) ? raw.careerHopes : [],
    careerEtc: raw.careerEtc || '',
    attitudePositive: Array.isArray(raw.attitudePositive) ? raw.attitudePositive : [],
    attitudePosEtc: raw.attitudePosEtc || '',
    problemBehaviors: Array.isArray(raw.problemBehaviors) ? raw.problemBehaviors : [],
    attitudeNegEtc: raw.attitudeNegEtc || '',
    guidanceAuto: Array.isArray(raw.guidanceAuto) ? raw.guidanceAuto : [],
    guidanceCustom: raw.guidanceCustom || ''
  };
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
  if (!info || !info.familyTypes || info.familyTypes.length === 0) return '-';
  return info.familyTypes.map(t => (t === '기타' && info.familyEtc) ? `기타(${info.familyEtc})` : t).join(', ');
}

function formatCareerText(info) {
  if (!info || !info.careerHopes || info.careerHopes.length === 0) return '-';
  return info.careerHopes.map(v => (v === '기타' && info.careerEtc) ? `기타(${info.careerEtc})` : v).join(', ');
}

function formatAttitudePosText(info) {
  if (!info || !info.attitudePositive || info.attitudePositive.length === 0) return '';
  return info.attitudePositive.map(v => (v === '기타' && info.attitudePosEtc) ? `기타(${info.attitudePosEtc})` : v).join(', ');
}

function formatAttitudeNegText(info) {
  if (!info || !info.problemBehaviors || info.problemBehaviors.length === 0) return '';
  return info.problemBehaviors.map(v => (v === '기타' && info.attitudeNegEtc) ? `기타(${info.attitudeNegEtc})` : v).join(', ');
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
  const info = getStudentBasicInfo(studentId);
  const parts = [];
  const famStr = formatFamilyText(info);
  if (famStr && famStr !== '-') parts.push(`가정:${famStr}`);
  if (info.economicStatus) parts.push(`경제:${info.economicStatus}`);
  const careerStr = formatCareerText(info);
  if (careerStr && careerStr !== '-') parts.push(`진로:${careerStr}`);
  const posStr = formatAttitudePosText(info);
  if (posStr) parts.push(`모범태도:${posStr}`);
  const negStr = formatAttitudeNegText(info);
  if (negStr) parts.push(`관심태도:${negStr}`);
  const guideStr = formatGuidanceText(info);
  if (guideStr) parts.push(`지도:${guideStr}`);

  if (parts.length === 0) {
    return `<span style="color:#888; font-size:0.8rem;">미입력</span>`;
  }
  return `<div style="font-size:0.8rem; color:#444; margin-bottom:0.25rem;">${escapeHtml(parts.join(' | '))}</div>`;
}

// -------------------- 5-2. [상담관리] 렌더링 --------------------
function renderCounselingSection() {
  const tbody = document.getElementById('counseling-student-tbody');
  if (!tbody) return;

  if (state.students.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="padding: 2rem; color: #6c757d;">
          출석부에 등록된 학생이 없습니다.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = state.students.map((stu, idx) => {
    const counselCount = state.counselings.filter(c => c.studentId === stu.id).length;
    const stats = calculateStudentAttendanceStats(stu.id);

    return `
      <tr>
        <td>${idx + 1}</td>
        <td><strong>${escapeHtml(stu.studentNo)}</strong></td>
        <td><strong>${escapeHtml(stu.name)}</strong></td>
        <td>${renderStatsBadgesHtml(stats)}</td>
        <td>
          ${renderBasicInfoSummaryBadges(stu.id)}
          <button class="btn btn-yellow btn-open-basic" data-stu-id="${stu.id}" style="padding:0.35rem 0.75rem; font-size:0.82rem;">
            📋 기본자료
          </button>
        </td>
        <td>
          <button class="btn btn-green btn-open-counsel" data-stu-id="${stu.id}">
            💬 상담
          </button>
        </td>
        <td>
          <span class="counsel-count-pill">${counselCount}회</span>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.btn-open-basic').forEach(btn => {
    btn.addEventListener('click', () => {
      const stuId = btn.getAttribute('data-stu-id');
      openBasicInfoModal(stuId);
    });
  });

  tbody.querySelectorAll('.btn-open-counsel').forEach(btn => {
    btn.addEventListener('click', () => {
      const stuId = btn.getAttribute('data-stu-id');
      openCounselModal(stuId);
    });
  });
}

function renderStatsBadgesHtml(stats) {
  const badges = [];
  badges.push(`<span class="mini-badge a1">미인정(A): ${stats.countA1}일</span>`);
  if (stats.isTotalAll50) {
    badges.push(`<span class="mini-badge t50">모든결석(A+B): ${stats.totalAll}일 (주황)</span>`);
  } else {
    badges.push(`<span class="mini-badge a2">모든결석(A+B): ${stats.totalAll}일</span>`);
  }
  if (stats.isStreak5) badges.push(`<span class="mini-badge s5">연속5일(노랑)</span>`);
  if (stats.isTotal35) badges.push(`<span class="mini-badge t35">누적35일(초록)</span>`);
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

  const sorted = [...state.counselings].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

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
      if (item) openStudentPersonalCounselModal(item.studentId);
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
      state.counselings = state.counselings.filter(c => c.id !== cid);
      saveState();
      renderAll();
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
            value="${escapeHtml(tch.pw)}"
            placeholder="비밀번호 입력 (예: 1234)"
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
      const pwVal = row.querySelector('.inp-tch-pw').value.trim();
      const noteVal = row.querySelector('.inp-tch-note').value.trim();

      if (!nameVal || !pwVal) {
        alert('교사명(아이디)과 비밀번호를 모두 입력해주세요.');
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

  // 최신순 정렬
  const sorted = [...state.counselings].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

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
      state.counselings = state.counselings.filter(c => c.id !== cid);
      saveState();
      renderAll();
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
  const posList = Array.from(formEl.querySelectorAll('input[name="attitudePositive"]:checked')).map(el => el.value);
  const negList = Array.from(formEl.querySelectorAll('input[name="problemBehavior"]:checked')).map(el => el.value);
  const econEl = formEl.querySelector('input[name="economicStatus"]:checked');
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

function openBasicInfoModal(studentId) {
  const stu = state.students.find(s => s.id === studentId);
  if (!stu) return;

  const modal = document.getElementById('modal-basic-info');
  const formEl = document.getElementById('form-basic-info');
  formEl.reset();

  const dateInp = document.getElementById('basic-info-date');
  if (dateInp) {
    dateInp.value = formatDateYMD(new Date());
  }

  document.getElementById('basic-student-id').value = stu.id;
  document.getElementById('basic-display-num').textContent = stu.studentNo;
  document.getElementById('basic-display-name').textContent = stu.name;

  // 출석부 자동 반영
  const stats = calculateStudentAttendanceStats(stu.id);
  const summaryBox = document.getElementById('basic-attendance-summary');
  summaryBox.innerHTML = `
    <div style="display:flex; flex-wrap:wrap; gap:0.45rem;">
      <span class="mini-badge a1">미인정(A) 누적: ${stats.countA1}일</span>
      <span class="mini-badge ${stats.isTotalAll50 ? 't50' : 'a2'}">모든결석(A+B) 누적: ${stats.totalAll}일 ${stats.isTotalAll50 ? '(50일 이상 - 주황)' : ''}</span>
      <span class="mini-badge ${stats.isStreak5 ? 's5' : ''}">
        연속5일(A): ${stats.isStreak5 ? `해당 (최대 연속 ${stats.maxConsecutiveA1}일)` : `미해당 (최대 ${stats.maxConsecutiveA1}일)`}
      </span>
      <span class="mini-badge ${stats.isTotal35 ? 't35' : ''}">
        누적35일(A): ${stats.isTotal35 ? '해당' : '미해당'}
      </span>
    </div>
  `;

  // 저장된 기본자료 불러와서 체크박스/라디오 상태 세팅
  const info = getStudentBasicInfo(stu.id);

  // 1) 가정형태
  formEl.querySelectorAll('input[name="familyType"]').forEach(chk => {
    chk.checked = (info.familyTypes || []).includes(chk.value);
  });
  const chkFamEtc = document.getElementById('chk-family-etc');
  const inpFamEtc = document.getElementById('family-etc-input');
  if (chkFamEtc && inpFamEtc) {
    const isFamEtc = (info.familyTypes || []).includes('기타');
    chkFamEtc.checked = isFamEtc;
    inpFamEtc.classList.toggle('hidden', !isFamEtc);
    inpFamEtc.value = isFamEtc ? (info.familyEtc || '') : '';
  }

  // 2) 경제적 형편
  const econVal = info.economicStatus || '중';
  formEl.querySelectorAll('input[name="economicStatus"]').forEach(rad => {
    rad.checked = rad.value === econVal;
  });

  // 3) 진로희망
  formEl.querySelectorAll('input[name="careerHope"]').forEach(chk => {
    chk.checked = (info.careerHopes || []).includes(chk.value);
  });
  const chkCarEtc = document.getElementById('chk-career-etc');
  const inpCarEtc = document.getElementById('career-etc-input');
  if (chkCarEtc && inpCarEtc) {
    const isCarEtc = (info.careerHopes || []).includes('기타');
    chkCarEtc.checked = isCarEtc;
    inpCarEtc.classList.toggle('hidden', !isCarEtc);
    inpCarEtc.value = isCarEtc ? (info.careerEtc || '') : '';
  }

  // 4) 생활태도 [긍정·모범]
  formEl.querySelectorAll('input[name="attitudePositive"]').forEach(chk => {
    chk.checked = (info.attitudePositive || []).includes(chk.value);
  });
  const chkPosEtc = document.getElementById('chk-attitude-pos-etc');
  const inpPosEtc = document.getElementById('attitude-pos-etc-input');
  if (chkPosEtc && inpPosEtc) {
    const isPosEtc = (info.attitudePositive || []).includes('기타');
    chkPosEtc.checked = isPosEtc;
    inpPosEtc.classList.toggle('hidden', !isPosEtc);
    inpPosEtc.value = isPosEtc ? (info.attitudePosEtc || '') : '';
  }

  // 5) 생활태도 [관심·지도]
  formEl.querySelectorAll('input[name="problemBehavior"]').forEach(chk => {
    chk.checked = (info.problemBehaviors || []).includes(chk.value);
  });
  const chkNegEtc = document.getElementById('chk-attitude-neg-etc');
  const inpNegEtc = document.getElementById('attitude-neg-etc-input');
  if (chkNegEtc && inpNegEtc) {
    const isNegEtc = (info.problemBehaviors || []).includes('기타');
    chkNegEtc.checked = isNegEtc;
    inpNegEtc.classList.toggle('hidden', !isNegEtc);
    inpNegEtc.value = isNegEtc ? (info.attitudeNegEtc || '') : '';
  }

  // 6) 지도방안 자동 계산 및 커스텀 입력값 채우기
  const guidanceInput = document.getElementById('guidance-input');
  if (guidanceInput) {
    guidanceInput.value = info.guidanceCustom || '';
  }
  updateGuidancePreview();

  modal.classList.remove('hidden');
}

function openCounselModal(selectedStudentId = null) {
  if (state.students.length === 0) {
    alert('먼저 관리자 메뉴에서 학생 명단을 추가해주세요.');
    return;
  }

  const modal = document.getElementById('modal-counsel-card');
  const selectEl = document.getElementById('counsel-student-select');
  const dateEl = document.getElementById('counsel-date');
  const formEl = document.getElementById('form-counsel-card');

  formEl.reset();

  // 학생 드롭다운 채우기
  selectEl.innerHTML = state.students.map(stu => `
    <option value="${stu.id}">${escapeHtml(stu.studentNo)} - ${escapeHtml(stu.name)}</option>
  `).join('');

  const targetId = selectedStudentId || state.students[0].id;
  selectEl.value = targetId;

  // 오늘 날짜 자동 표기
  dateEl.value = formatDateYMD(new Date());

  updateCounselModalStudentPreview(targetId);
  modal.classList.remove('hidden');
}

function updateCounselModalStudentPreview(studentId) {
  const stu = state.students.find(s => s.id === studentId);
  if (!stu) return;

  document.getElementById('card-display-num').textContent = stu.studentNo;
  document.getElementById('card-display-name').textContent = stu.name;
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

  // 기본자료 변동 이력
  const stuHistories = (state.basicInfoHistory && state.basicInfoHistory[studentId])
    ? state.basicInfoHistory[studentId]
    : [];

  const historyByDate = {};
  stuHistories.forEach(h => {
    if (!historyByDate[h.date]) historyByDate[h.date] = [];
    if (Array.isArray(h.changes)) {
      historyByDate[h.date].push(...h.changes);
    } else if (typeof h.changesText === 'string') {
      historyByDate[h.date].push(h.changesText);
    }
  });

  const counselByDate = {};
  stuCounsels.forEach(c => {
    if (!counselByDate[c.date]) counselByDate[c.date] = [];
    counselByDate[c.date].push(c.content);
  });

  const allDates = [...new Set([...Object.keys(historyByDate), ...Object.keys(counselByDate)])]
    .sort((a, b) => a.localeCompare(b));

  const modal = document.getElementById('modal-detail-view');
  const titleEl = document.getElementById('detail-modal-title');
  const bodyEl = document.getElementById('detail-modal-body');

  titleEl.textContent = `📄 개인 기본자료 및 상담 기록 (${stu.studentNo} ${stu.name})`;

  const counselsTimelineHtml = allDates.length === 0
    ? `<p style="color:#6c757d; padding:0.75rem 0;">등록된 상담 기록 및 기본자료 변동 내역이 없습니다.</p>`
    : `
      <div class="scroll-10-rows">
        <table class="detail-table">
          <thead>
            <tr>
              <th style="width:115px; text-align:center;">상담 날짜</th>
              <th style="width:250px; text-align:left;">기본자료 변동</th>
              <th style="text-align:left;">상담 내용</th>
            </tr>
          </thead>
          <tbody>
            ${allDates.map(d => {
              const changes = historyByDate[d] || [];
              const contents = counselByDate[d] || [];
              const changesHtml = changes.length > 0
                ? changes.map(ch => `<div class="history-blue-text">${escapeHtml(ch)}</div>`).join('')
                : `<span style="color:#aaa;">-</span>`;
              const contentsHtml = contents.length > 0
                ? contents.map(content => `<div class="detail-content-scroll">${escapeHtml(content)}</div>`).join('<hr style="margin:6px 0; border:0; border-top:1px dashed #ddd;"/>')
                : `<span style="color:#aaa; font-size:0.85rem;">(상담내용 없음)</span>`;

              return `
                <tr>
                  <td style="text-align:center; font-weight:700; background:#fffdf5; vertical-align:top;">${escapeHtml(d)}</td>
                  <td style="vertical-align:top;">${changesHtml}</td>
                  <td style="vertical-align:top;">${contentsHtml}</td>
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
    <h4 style="margin-bottom:0.35rem; color:#d84b73;">📋 1. 학생 기본자료 (현재 최신 내용)</h4>
    <table class="detail-table" style="margin-bottom: 1.2rem;">
      <tr>
        <th>학번 / 이름</th>
        <td><strong>${escapeHtml(stu.studentNo)}</strong> / <strong>${escapeHtml(stu.name)}</strong></td>
      </tr>
      <tr>
        <th>출결사항</th>
        <td>
          미인정(A): <strong>${stats.countA1}일</strong> |
          모든결석(A+B): <strong>${stats.totalAll}일</strong> (A: ${stats.countA1}일, B: ${stats.countA2}일) ${stats.isTotalAll50 ? '<span class="mini-badge t50">50일 이상 (주황색)</span>' : ''}<br/>
          연속5일(A): <strong>${stats.isStreak5 ? `해당 (연속 ${stats.maxConsecutiveA1}일 - 노란색)` : '미해당'}</strong> |
          누적35일(A): <strong>${stats.isTotal35 ? '해당 (초록색)' : '미해당'}</strong>
        </td>
      </tr>
      <tr>
        <th>가정형태</th>
        <td>${escapeHtml(formatFamilyText(basic))}</td>
      </tr>
      <tr>
        <th>경제적 형편</th>
        <td>${escapeHtml(basic.economicStatus || '-')}</td>
      </tr>
      <tr>
        <th>진로희망</th>
        <td>${escapeHtml(formatCareerText(basic))}</td>
      </tr>
      <tr>
        <th>생활태도 [긍정·모범]</th>
        <td>${escapeHtml(formatAttitudePosText(basic) || '없음')}</td>
      </tr>
      <tr>
        <th>생활태도 [관심·지도]</th>
        <td>${escapeHtml(formatAttitudeNegText(basic) || '없음')}</td>
      </tr>
      <tr style="background:#fff4e6;">
        <th style="color:#d9480f;">💡 [지도방안]</th>
        <td>${guidanceDisplay}</td>
      </tr>
    </table>

    <h4 style="margin-bottom:0.35rem; color:#1e6091;">💬 2. 날짜별 기본자료 변동 및 상담 내용</h4>
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
    if (!historyByDate[h.date]) historyByDate[h.date] = [];
    if (Array.isArray(h.changes)) {
      historyByDate[h.date].push(...h.changes);
    } else if (typeof h.changesText === 'string') {
      historyByDate[h.date].push(h.changesText);
    }
  });

  const counselByDate = {};
  stuCounsels.forEach(c => {
    if (!counselByDate[c.date]) counselByDate[c.date] = [];
    counselByDate[c.date].push(c.content);
  });

  const allDates = [...new Set([...Object.keys(historyByDate), ...Object.keys(counselByDate)])]
    .sort((a, b) => a.localeCompare(b));

  const counselsRowsHtml = allDates.length === 0
    ? `<tr><td colspan="3" style="text-align:center; color:#666;">등록된 상담 기록 및 기본자료 변동 내역이 없습니다.</td></tr>`
    : allDates.map(d => {
      const changes = historyByDate[d] || [];
      const contents = counselByDate[d] || [];
      const changesHtml = changes.length > 0
        ? changes.map(ch => `<div style="color:#1971c2; font-weight:bold;">${escapeHtml(ch)}</div>`).join('')
        : `<span style="color:#999;">-</span>`;
      const contentsHtml = contents.length > 0
        ? contents.map(c => `<div style="white-space:pre-wrap;">${escapeHtml(c)}</div>`).join('<hr style="margin:4px 0; border:0; border-top:1px dashed #ccc;"/>')
        : `<span style="color:#999;">(상담내용 없음)</span>`;

      return `
        <tr>
          <td style="width:110px; text-align:center; font-weight:bold; background:#fffdf5; vertical-align:top;">${escapeHtml(d)}</td>
          <td style="vertical-align:top; width:220px;">${changesHtml}</td>
          <td style="vertical-align:top;">${contentsHtml}</td>
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
          미인정결석 누적(A): ${stats.countA1}일<br/>
          모든결석 누적(A+B): ${stats.totalAll}일 (A: ${stats.countA1}일, B: ${stats.countA2}일) ${stats.isTotalAll50 ? '<span class="badge-orange">50일 이상 해당 (주황색)</span>' : ''}<br/>
          연속 5일(A): ${stats.isStreak5 ? `<span class="badge-yellow">해당 (최대 연속 ${stats.maxConsecutiveA1}일)</span>` : '미해당'}<br/>
          누적 35일(A): ${stats.isTotal35 ? '<span class="badge-green">해당</span>' : '미해당'}
        </td>
      </tr>
      <tr><th>가정형태</th><td>${escapeHtml(formatFamilyText(basic))}</td></tr>
      <tr><th>경제적 형편</th><td>${escapeHtml(basic.economicStatus || '-')}</td></tr>
      <tr><th>진로희망</th><td>${escapeHtml(formatCareerText(basic))}</td></tr>
      <tr><th>생활태도 [긍정·모범]</th><td>${escapeHtml(formatAttitudePosText(basic) || '없음')}</td></tr>
      <tr><th>생활태도 [관심·지도]</th><td>${escapeHtml(formatAttitudeNegText(basic) || '없음')}</td></tr>
      <tr style="background-color:#ffe8cc;">
        <th style="color:#d9480f;">💡 [지도방안]</th>
        <td><strong>${escapeHtml(guidanceDisplay)}</strong></td>
      </tr>
    </table>

    <h2>2. 날짜별 상담 내용 및 기본자료 변동 (${allDates.length}건)</h2>
    <table>
      <thead>
        <tr>
          <th style="width:110px; text-align:center;">상담 날짜</th>
          <th style="width:220px; text-align:left;">기본자료 변동</th>
          <th>상담 내용</th>
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
  const sections = ['section-attendance', 'section-counseling', 'section-support', 'section-homeroom', 'section-admin'];
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

  // 1-A) 관리자 로그인 폼 처리
  const adminLoginForm = document.getElementById('admin-login-form');
  if (adminLoginForm) {
    adminLoginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const inputId = document.getElementById('admin-login-id').value.trim().normalize('NFC');
      const inputPw = document.getElementById('admin-login-pw').value.trim().normalize('NFC');
      const targetId = ADMIN_CREDENTIALS.id.normalize('NFC');
      const targetPw = ADMIN_CREDENTIALS.pw.normalize('NFC');
      const errEl = document.getElementById('admin-login-error');

      if (inputId === targetId && inputPw === targetPw) {
        errEl.classList.add('hidden');
        loginAsAccount({
          role: 'admin',
          id: 'admin',
          name: '예성원',
          note: '관리자'
        });
      } else {
        errEl.classList.remove('hidden');
      }
    });
  }

  // 1-B) 선생님(담임) 로그인 폼 처리
  const teacherLoginForm = document.getElementById('teacher-login-form');
  if (teacherLoginForm) {
    teacherLoginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const inputId = document.getElementById('teacher-login-id').value.trim().normalize('NFC');
      const inputPw = document.getElementById('teacher-login-pw').value.trim().normalize('NFC');
      const errEl = document.getElementById('teacher-login-error');

      const teacher = (state.teachers || []).find(t =>
        (t.name || '').trim().normalize('NFC') === inputId &&
        (t.pw || '').trim().normalize('NFC') === inputPw
      );

      if (teacher) {
        errEl.classList.add('hidden');
        loginAsAccount({
          role: 'teacher',
          id: teacher.id,
          name: teacher.name,
          note: teacher.note || '담임교사'
        });
      } else {
        errEl.classList.remove('hidden');
      }
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

  // 4) 상담관리 -> [+ 상담 행 추가 / 새 상담 작성]
  document.getElementById('btn-quick-counsel-row').addEventListener('click', () => {
    openCounselModal(null);
  });

  // 상담 모달 내 학생 변경 시 학번/이름 실시간 갱신
  document.getElementById('counsel-student-select').addEventListener('change', (e) => {
    updateCounselModalStudentPreview(e.target.value);
  });

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

  // 학생 기본자료 저장 & 변동 이력(diff) 자동 기록
  document.getElementById('form-basic-info').addEventListener('submit', (e) => {
    e.preventDefault();
    const stuId = document.getElementById('basic-student-id').value;
    if (!stuId) return;

    const formEl = document.getElementById('form-basic-info');
    const oldInfo = getStudentBasicInfo(stuId);

    const familyTypes = Array.from(formEl.querySelectorAll('input[name="familyType"]:checked')).map(el => el.value);
    const chkFamEtc = document.getElementById('chk-family-etc');
    const inpFamEtc = document.getElementById('family-etc-input');
    const familyEtc = (chkFamEtc && chkFamEtc.checked && inpFamEtc) ? inpFamEtc.value.trim() : '';

    const economicEl = formEl.querySelector('input[name="economicStatus"]:checked');
    const economicStatus = economicEl ? economicEl.value : '중';

    const careerHopes = Array.from(formEl.querySelectorAll('input[name="careerHope"]:checked')).map(el => el.value);
    const chkCarEtc = document.getElementById('chk-career-etc');
    const inpCarEtc = document.getElementById('career-etc-input');
    const careerEtc = (chkCarEtc && chkCarEtc.checked && inpCarEtc) ? inpCarEtc.value.trim() : '';

    const attitudePositive = Array.from(formEl.querySelectorAll('input[name="attitudePositive"]:checked')).map(el => el.value);
    const chkPosEtc = document.getElementById('chk-attitude-pos-etc');
    const inpPosEtc = document.getElementById('attitude-pos-etc-input');
    const attitudePosEtc = (chkPosEtc && chkPosEtc.checked && inpPosEtc) ? inpPosEtc.value.trim() : '';

    const problemBehaviors = Array.from(formEl.querySelectorAll('input[name="problemBehavior"]:checked')).map(el => el.value);
    const chkNegEtc = document.getElementById('chk-attitude-neg-etc');
    const inpNegEtc = document.getElementById('attitude-neg-etc-input');
    const attitudeNegEtc = (chkNegEtc && chkNegEtc.checked && inpNegEtc) ? inpNegEtc.value.trim() : '';

    const newGuidanceAuto = calculateAutoGuidance({ attitudePositive, problemBehaviors, economicStatus });
    const guidanceInput = document.getElementById('guidance-input');
    const guidanceCustom = guidanceInput ? guidanceInput.value.trim() : '';

    // 변동 내역(Diff) 계산: 해제 시 "** -> 해제", 변경 시 "** -> **"
    const diffList = [];

    // 1) 가정형태 변동
    const oldFam = (oldInfo.familyTypes || []).map(t => (t === '기타' && oldInfo.familyEtc) ? `기타(${oldInfo.familyEtc})` : t);
    const newFam = familyTypes.map(t => (t === '기타' && familyEtc) ? `기타(${familyEtc})` : t);
    const removedFam = oldFam.filter(x => !newFam.includes(x));
    const addedFam = newFam.filter(x => !oldFam.includes(x));
    if (removedFam.length === 1 && addedFam.length === 1) {
      diffList.push(`가정형태: ${removedFam[0]} -> ${addedFam[0]}`);
    } else {
      removedFam.forEach(item => diffList.push(`가정형태: ${item} -> 해제`));
      addedFam.forEach(item => diffList.push(`가정형태: ${item} -> 선택`));
    }

    // 2) 경제적 형편 변동
    if (oldInfo.economicStatus && oldInfo.economicStatus !== economicStatus) {
      diffList.push(`경제적 형편: ${oldInfo.economicStatus} -> ${economicStatus}`);
    }

    // 3) 진로희망 변동
    const oldCar = (oldInfo.careerHopes || []).map(t => (t === '기타' && oldInfo.careerEtc) ? `기타(${oldInfo.careerEtc})` : t);
    const newCar = careerHopes.map(t => (t === '기타' && careerEtc) ? `기타(${careerEtc})` : t);
    const removedCar = oldCar.filter(x => !newCar.includes(x));
    const addedCar = newCar.filter(x => !oldCar.includes(x));
    if (removedCar.length === 1 && addedCar.length === 1) {
      diffList.push(`진로희망: ${removedCar[0]} -> ${addedCar[0]}`);
    } else {
      removedCar.forEach(item => diffList.push(`진로희망: ${item} -> 해제`));
      addedCar.forEach(item => diffList.push(`진로희망: ${item} -> 선택`));
    }

    // 4) 생활태도 [긍정·모범] 변동
    const oldPos = (oldInfo.attitudePositive || []).map(t => (t === '기타' && oldInfo.attitudePosEtc) ? `기타(${oldInfo.attitudePosEtc})` : t);
    const newPos = attitudePositive.map(t => (t === '기타' && attitudePosEtc) ? `기타(${attitudePosEtc})` : t);
    const removedPos = oldPos.filter(x => !newPos.includes(x));
    const addedPos = newPos.filter(x => !oldPos.includes(x));
    removedPos.forEach(item => diffList.push(`생활태도(긍정): ${item} -> 해제`));
    addedPos.forEach(item => diffList.push(`생활태도(긍정): ${item} -> 선택`));

    // 5) 생활태도 [관심·지도] 변동
    const oldNeg = (oldInfo.problemBehaviors || []).map(t => (t === '기타' && oldInfo.attitudeNegEtc) ? `기타(${oldInfo.attitudeNegEtc})` : t);
    const newNeg = problemBehaviors.map(t => (t === '기타' && attitudeNegEtc) ? `기타(${attitudeNegEtc})` : t);
    const removedNeg = oldNeg.filter(x => !newNeg.includes(x));
    const addedNeg = newNeg.filter(x => !oldNeg.includes(x));
    removedNeg.forEach(item => diffList.push(`생활태도(관심): ${item} -> 해제`));
    addedNeg.forEach(item => diffList.push(`생활태도(관심): ${item} -> 선택`));

    // 6) 지도방안 변동
    const oldGuide = oldInfo.guidanceAuto || [];
    const removedGuide = oldGuide.filter(x => !newGuidanceAuto.includes(x));
    const addedGuide = newGuidanceAuto.filter(x => !oldGuide.includes(x));
    removedGuide.forEach(item => diffList.push(`지도방안: ${item} -> 해제`));
    addedGuide.forEach(item => diffList.push(`지도방안: ${item} -> 제안`));
    if (oldInfo.guidanceCustom !== guidanceCustom && (oldInfo.guidanceCustom || guidanceCustom)) {
      diffList.push(`지도방안(직접): ${oldInfo.guidanceCustom || '없음'} -> ${guidanceCustom || '없음'}`);
    }

    const dateInp = document.getElementById('basic-info-date');
    const recordDate = (dateInp && dateInp.value) ? dateInp.value : formatDateYMD(new Date());

    // 초기 등록 시 또는 기존 변경 이력이 없는 경우에도 첫 저장 내용을 diffList에 등록
    if (diffList.length === 0 && (!state.basicInfoHistory?.[stuId] || state.basicInfoHistory[stuId].length === 0)) {
      if (familyTypes.length > 0) diffList.push(`가정형태: ${familyTypes.join(', ')}`);
      if (economicStatus) diffList.push(`경제적 형편: ${economicStatus}`);
      if (careerHopes.length > 0) diffList.push(`진로희망: ${careerHopes.join(', ')}`);
      if (attitudePositive.length > 0) diffList.push(`생활태도(긍정): ${attitudePositive.join(', ')}`);
      if (problemBehaviors.length > 0) diffList.push(`생활태도(관심): ${problemBehaviors.join(', ')}`);
    }

    // 변경 내역이 있는 경우 사용자가 직접 입력/선택한 날짜(recordDate)의 행에 기록
    if (diffList.length > 0) {
      if (!state.basicInfoHistory) state.basicInfoHistory = {};
      if (!state.basicInfoHistory[stuId]) state.basicInfoHistory[stuId] = [];
      const existingHistory = state.basicInfoHistory[stuId].find(h => h.date === recordDate);
      if (existingHistory) {
        if (!Array.isArray(existingHistory.changes)) existingHistory.changes = [];
        existingHistory.changes.push(...diffList);
      } else {
        state.basicInfoHistory[stuId].push({
          date: recordDate,
          changes: diffList
        });
      }
    }

    if (!state.basicInfos) state.basicInfos = {};
    state.basicInfos[stuId] = {
      familyTypes,
      familyEtc,
      economicStatus,
      careerHopes,
      careerEtc,
      attitudePositive,
      attitudePosEtc,
      problemBehaviors,
      attitudeNegEtc,
      guidanceAuto: newGuidanceAuto,
      guidanceCustom
    };

    saveState();
    document.getElementById('modal-basic-info').classList.add('hidden');
    renderAll();
  });

  // 상담내용 저장 (상담란만 기록)
  document.getElementById('form-counsel-card').addEventListener('submit', (e) => {
    e.preventDefault();
    const stuId = document.getElementById('counsel-student-select').value;
    const stu = state.students.find(s => s.id === stuId);
    if (!stu) return;

    const dateVal = document.getElementById('counsel-date').value;
    const content = document.getElementById('counsel-content').value.trim();

    if (!content) {
      alert('상담내용을 입력해주세요.');
      return;
    }

    const newCounsel = {
      id: 'c-' + Date.now(),
      studentId: stu.id,
      studentNo: stu.studentNo,
      studentName: stu.name,
      date: dateVal,
      content
    };

    state.counselings.push(newCounsel);
    saveState();
    document.getElementById('modal-counsel-card').classList.add('hidden');
    renderAll();
  });

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
        pw: '',
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
      supportLinks: state.supportLinks || []
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
