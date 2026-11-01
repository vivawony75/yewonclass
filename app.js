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

// ============================================================================
// 2. 초기 샘플 데이터 및 앱 상태
// ============================================================================
function getInitialState() {
  return {
    students: [
      { id: 'stu-1', studentNo: '10101', name: '김금쪽', isEditing: false },
      { id: 'stu-2', studentNo: '10102', name: '이사랑', isEditing: false },
      { id: 'stu-3', studentNo: '10103', name: '박희망', isEditing: false },
      { id: 'stu-4', studentNo: '10104', name: '최햇살', isEditing: false },
      { id: 'stu-5', studentNo: '10105', name: '정바름', isEditing: false }
    ],
    // attendance: { [studentId]: { "YYYY-MM-DD": "A" | "B" } }
    attendance: {},
    // holidays: { "YYYY-MM-DD": true } (체크박스로 지정한 학교 재량휴업일/공휴일)
    holidays: {},
    // holidayReasons: { "YYYY-MM-DD": "공휴일/휴업 사유 또는 행사명" }
    holidayReasons: {},
    // basicInfos: { [studentId]: { familyTypes, familyEtc, economicStatus, careerHopes, careerEtc, attitudePositive, attitudePosEtc, problemBehaviors, attitudeNegEtc, guidanceAuto, guidanceCustom } }
    basicInfos: {},
    // basicInfoHistory: { [studentId]: [ { date: "YYYY-MM-DD", changes: ["항목: 이전 -> 이후"] } ] }
    basicInfoHistory: {},
    // counselings: [{ id, studentId, studentNo, studentName, date, content }]
    counselings: []
  };
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
    const att = parsed.attendance || {};
    // 기존 A1/A2 입력값이 남아있을 경우 A/B로 자동 변환
    Object.keys(att).forEach(stuId => {
      Object.keys(att[stuId] || {}).forEach(ymd => {
        if (att[stuId][ymd] === 'A1') att[stuId][ymd] = 'A';
        else if (att[stuId][ymd] === 'A2') att[stuId][ymd] = 'B';
      });
    });

    const counselings = Array.isArray(parsed.counselings) ? parsed.counselings : [];
    const basicInfos = parsed.basicInfos || {};

    // 기존 상담 기록에 가정형태 등 기본자료가 들어있던 경우 학생별 기본자료(basicInfos)로 자동 이관
    counselings.forEach(c => {
      if (c.studentId && !basicInfos[c.studentId]) {
        if (c.familyTypes || c.economicStatus || c.careerHopes || c.problemBehaviors) {
          basicInfos[c.studentId] = {
            familyTypes: c.familyTypes || [],
            familyEtc: c.familyEtc || '',
            economicStatus: c.economicStatus || '중',
            careerHopes: c.careerHopes || [],
            careerEtc: c.careerEtc || '',
            attitudePositive: c.attitudePositive || [],
            attitudePosEtc: c.attitudePosEtc || '',
            problemBehaviors: c.problemBehaviors || [],
            attitudeNegEtc: c.attitudeNegEtc || '',
            guidanceAuto: c.guidanceAuto || [],
            guidanceCustom: c.guidanceCustom || ''
          };
        }
      }
    });

    return {
      students: Array.isArray(parsed.students) ? parsed.students : getInitialState().students,
      attendance: att,
      holidays: parsed.holidays || {},
      holidayReasons: parsed.holidayReasons || {},
      basicInfos,
      basicInfoHistory: parsed.basicInfoHistory || {},
      counselings
    };
  } catch (e) {
    console.warn('로컬 데이터 로드 실패, 기본값 사용:', e);
    return getInitialState();
  }
}

async function saveState() {
  // 편집 상태 플래그를 제외한 순수 데이터 저장
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (firestoreDb && !isSyncingFromCloud) {
    try {
      const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      await setDoc(doc(firestoreDb, 'appData', 'mainState'), {
        students: state.students.map(s => ({ id: s.id, studentNo: s.studentNo, name: s.name })),
        attendance: state.attendance,
        holidays: state.holidays,
        holidayReasons: state.holidayReasons || {},
        basicInfos: state.basicInfos || {},
        basicInfoHistory: state.basicInfoHistory || {},
        counselings: state.counselings,
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
    const val = (stuRecords[ymd] || '').toUpperCase().trim();
    if (val === 'A' || val === 'A1') countA1++;
    else if (val === 'B' || val === 'A2') countA2++;
  }

  // 연속 미인정결석(A) 최대 일수 계산 (주말·공휴일·휴업일은 건너뛰며 앞뒤 연결)
  let maxConsecutiveA1 = 0;
  const a1Dates = recordedDates.filter(ymd => {
    if (state.holidays && state.holidays[ymd]) return false;
    const mark = (stuRecords[ymd] || '').toUpperCase().trim();
    return mark === 'A' || mark === 'A1';
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
        const mark = (stuRecords[ymd] || '').toUpperCase().trim();
        if (mark === 'A' || mark === 'A1') {
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
  renderAdminSection();
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
      const upperVal = rawVal.toUpperCase();
      const valClass = upperVal === 'A' ? 'val-a1' : (upperVal === 'B' ? 'val-a2' : '');

      return `
        <td class="${isHoliday ? 'is-holiday-col' : ''}">
          <input
            type="text"
            class="att-input ${valClass}"
            data-stu-id="${stu.id}"
            data-ymd="${dayInfo.ymd}"
            value="${upperVal}"
            maxlength="1"
            placeholder="${isHoliday ? '휴업' : ''}"
            ${isHoliday ? 'disabled' : ''}
            title="미인정결석: A, 기타결석: B, 출석: 빈칸"
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

  // 출결 입력 이벤트 바인딩 (직접 입력: 빈칸, A, B)
  tbody.querySelectorAll('.att-input').forEach(input => {
    input.addEventListener('input', (e) => {
      const stuId = e.target.getAttribute('data-stu-id');
      const ymd = e.target.getAttribute('data-ymd');
      const val = e.target.value.toUpperCase().trim();

      if (!state.attendance[stuId]) {
        state.attendance[stuId] = {};
      }

      if (val === '') {
        delete state.attendance[stuId][ymd];
      } else {
        state.attendance[stuId][ymd] = val;
      }

      e.target.classList.toggle('val-a1', val === 'A');
      e.target.classList.toggle('val-a2', val === 'B');

      saveState();
      updateSingleStudentRowStats(stuId);
      renderCounselingSection();
      renderAdminSection();
    });

    input.addEventListener('blur', (e) => {
      const val = e.target.value.toUpperCase().trim();
      if (val !== '' && val !== 'A' && val !== 'B') {
        alert('출결 입력란에는 미인정결석(A), 그 외 결석(B)만 입력하거나 출석 시 빈칸으로 두세요.');
        const stuId = e.target.getAttribute('data-stu-id');
        const ymd = e.target.getAttribute('data-ymd');
        e.target.value = '';
        if (state.attendance[stuId]) {
          delete state.attendance[stuId][ymd];
        }
        e.target.classList.remove('val-a1', 'val-a2');
        saveState();
        updateSingleStudentRowStats(stuId);
        renderCounselingSection();
        renderAdminSection();
      } else {
        e.target.value = val;
      }
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

// -------------------- 5-3. [관리자] 렌더링 --------------------
function renderAdminSection() {
  renderAdminStudentsTable();
  renderAdminCounselTable();
  renderAdminAttendanceCareTable();
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
  const raw = localStorage.getItem(FIREBASE_CONFIG_KEY);
  const badge = document.getElementById('sync-status');
  if (!raw) {
    badge.textContent = '로컬 저장 모드';
    badge.className = 'sync-badge local';
    firestoreDb = null;
    return;
  }

  try {
    const cfg = JSON.parse(raw);
    if (!cfg.apiKey || !cfg.projectId) return;

    const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    const { getFirestore, doc, onSnapshot } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

    const app = getApps().length === 0 ? initializeApp(cfg) : getApps()[0];
    firestoreDb = getFirestore(app);

    badge.textContent = '☁️ Firebase 실시간 연동중';
    badge.className = 'sync-badge cloud';

    onSnapshot(doc(firestoreDb, 'appData', 'mainState'), (snap) => {
      if (snap.exists()) {
        const cloudData = snap.data();
        isSyncingFromCloud = true;
        state.students = cloudData.students || state.students;
        state.attendance = cloudData.attendance || {};
        state.holidays = cloudData.holidays || {};
        state.holidayReasons = cloudData.holidayReasons || {};
        state.basicInfos = cloudData.basicInfos || {};
        state.basicInfoHistory = cloudData.basicInfoHistory || {};
        state.counselings = cloudData.counselings || [];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        renderAll();
        isSyncingFromCloud = false;
      } else {
        saveState();
      }
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

function setLoggedInUI(isLoggedIn) {
  const loginView = document.getElementById('login-view');
  const appContent = document.getElementById('app-content');
  const mainNav = document.getElementById('main-nav');
  const adminInfo = document.getElementById('admin-user-info');

  if (isLoggedIn) {
    loginView.classList.add('hidden');
    appContent.classList.remove('hidden');
    mainNav.classList.remove('hidden');
    adminInfo.classList.remove('hidden');
    renderAll();
  } else {
    loginView.classList.remove('hidden');
    appContent.classList.add('hidden');
    mainNav.classList.add('hidden');
    adminInfo.classList.add('hidden');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // 세션 로그인 복원
  const isLogged = sessionStorage.getItem(SESSION_AUTH_KEY) === 'true';
  setLoggedInUI(isLogged);
  initFirebaseIfConfigured();

  // 1) 로그인 폼 처리 (NFC 정규화 비교 적용)
  const loginForm = document.getElementById('login-form');
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const inputId = document.getElementById('login-id').value.trim().normalize('NFC');
    const inputPw = document.getElementById('login-pw').value.trim().normalize('NFC');
    const targetId = ADMIN_CREDENTIALS.id.normalize('NFC');
    const targetPw = ADMIN_CREDENTIALS.pw.normalize('NFC');
    const errEl = document.getElementById('login-error');

    if (inputId === targetId && inputPw === targetPw) {
      errEl.classList.add('hidden');
      sessionStorage.setItem(SESSION_AUTH_KEY, 'true');
      setLoggedInUI(true);
    } else {
      errEl.classList.remove('hidden');
    }
  });

  // 로그아웃
  document.getElementById('btn-logout').addEventListener('click', () => {
    sessionStorage.removeItem(SESSION_AUTH_KEY);
    document.getElementById('login-form').reset();
    setLoggedInUI(false);
  });

  // 2) 상단 메뉴 클릭 시 해당 섹션으로 부드럽게 스크롤 (스크롤형 웹앱)
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const targetId = btn.getAttribute('data-target');
      const section = document.getElementById(targetId);
      if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // 스크롤 위치에 따른 상단 메뉴 활성화 동기화
  window.addEventListener('scroll', () => {
    const sections = ['section-attendance', 'section-counseling', 'section-admin'];
    let currentId = sections[0];
    for (const id of sections) {
      const el = document.getElementById(id);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.top <= 160) {
          currentId = id;
        }
      }
    }
    navBtns.forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-target') === currentId);
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

    // 변경 내역이 있는 경우 해당 날짜로 기록
    if (diffList.length > 0) {
      const todayYmd = formatDateYMD(new Date());
      if (!state.basicInfoHistory) state.basicInfoHistory = {};
      if (!state.basicInfoHistory[stuId]) state.basicInfoHistory[stuId] = [];
      state.basicInfoHistory[stuId].push({
        date: todayYmd,
        changes: diffList
      });
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
    const row = document.querySelector(`tr[data-admin-stu="${newId}"]`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.querySelector('.inp-stu-no').focus();
    }
  });

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
    // 상담 기록이 있는 학생들별로 기본자료 + 날짜별 상담내용을 연달아 출력
    const studentIdsWithCounsel = [...new Set(state.counselings.map(c => c.studentId))];
    const sectionsHtml = studentIdsWithCounsel
      .map(stuId => buildStudentPersonalWordHtml(stuId))
      .join('<hr style="margin:24px 0; border:0; border-top:2px dashed #ccc;" />');

    triggerWordDownload(`내금쪽이들_전체상담내역_${formatDateYMD(new Date())}.doc`, sectionsHtml);
  });

  // 상세 모달 내 Word 다운로드 버튼
  document.getElementById('btn-modal-word-download').addEventListener('click', () => {
    if (typeof activeDetailWordGenerator === 'function') {
      activeDetailWordGenerator();
    }
  });

  // 7) Firebase 연동 설정 모달
  document.getElementById('btn-open-firebase-modal').addEventListener('click', () => {
    const raw = localStorage.getItem(FIREBASE_CONFIG_KEY);
    if (raw) {
      try {
        const cfg = JSON.parse(raw);
        document.getElementById('fb-api-key').value = cfg.apiKey || '';
        document.getElementById('fb-project-id').value = cfg.projectId || '';
        document.getElementById('fb-app-id').value = cfg.appId || '';
      } catch (e) {}
    }
    document.getElementById('modal-firebase-config').classList.remove('hidden');
  });

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
