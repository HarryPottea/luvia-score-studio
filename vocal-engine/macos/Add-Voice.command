#!/bin/bash
set -euo pipefail
ROOT="$HOME/Library/Application Support/J-WOO Vocal Engine/v1"
FILE=$(/usr/bin/osascript -e 'POSIX path of (choose file with prompt "공식 한국어 DiffSinger 모델 ZIP 선택")')
GENDER=$(/usr/bin/osascript -e 'choose from list {"남성", "여성"} with prompt "보컬 실제 성별 선택"')
[[ "$GENDER" != false ]]
CREDIT=$(/usr/bin/osascript -e 'text returned of (display dialog "모델 공식 크레딧" default answer "")')
TERMS=$(/usr/bin/osascript -e 'text returned of (display dialog "공식 이용약관 HTTPS URL" default answer "https://")')
/usr/bin/open "$TERMS"
/usr/bin/osascript -e 'display dialog "한국어 지원 및 사용 목적(가이드 제작, 상업·종교 활동 포함)에 필요한 권리를 확인했습니다. 모델은 공식 파일이며 재배포되지 않습니다." buttons {"취소", "확인 후 등록"} default button "확인 후 등록" cancel button "취소"' >/dev/null
"$ROOT/runtime/node" "$ROOT/voice-import.mjs" "$FILE" "$GENDER" "$CREDIT" "$TERMS" I_HAVE_RIGHTS
