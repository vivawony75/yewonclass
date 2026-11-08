@echo off
chcp 65001 > nul
echo ========================================================
echo   [내 금쪽이들] GitHub & Vercel 원클릭 연동 및 업로드
echo ========================================================
echo.

:: 1. Git 설치 여부 확인
git --version > nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] Git이 설치되어 있지 않거나 환경변수 PATH에 등록되지 않았습니다.
    echo https://git-scm.com 에서 Git을 다운로드 후 설치해주세요.
    pause
    exit /b
)

:: 2. Git 저장소 초기화
if not exist ".git" (
    echo [1/3] 새 Git 저장소를 초기화합니다...
    git init
    git branch -M main
) else (
    echo [1/3] 기존 Git 저장소를 확인했습니다.
)

:: 3. 파일 스테이징 및 커밋
echo [2/3] 최신 변경사항을 커밋합니다...
git add .
git commit -m "내 금쪽이들 최신 업데이트: 상담관리-담임관리 삭제 연동 및 Firebase 동기화"

:: 4. 원격 저장소(GitHub) 주소 확인 및 푸시
echo.
git remote get-url origin > nul 2>&1
if %errorlevel% neq 0 (
    echo [안내] 연결할 GitHub 리포지토리 주소를 입력해주세요.
    echo 예시: https://github.com/사용자아이디/내금쪽이들.git
    set /p REPO_URL="GitHub Repository URL: "
    if not "%REPO_URL%"=="" (
        git remote add origin %REPO_URL%
        git push -u origin main
    )
) else (
    echo [3/3] GitHub 원격 저장소로 최신 코드를 푸시합니다...
    git push -u origin main
)

echo.
echo ========================================================
echo   업로드가 완료되었습니다!
echo   Vercel 대시보드(vercel.com)에서 GitHub 리포지토리를
echo   선택하시면 1초 만에 무료 웹사이트로 자동 배포됩니다.
echo ========================================================
pause
