#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
/usr/bin/osascript -e 'display dialog "J-WOO 보컬 엔진을 현재 Mac 사용자 계정에 설치합니다. Chiaki 공식 모델(약 451MB)을 직접 내려받습니다. 추가 구독료는 없으며 로그인 시 엔진 실행을 등록합니다. 이용약관 확인 후에만 계속하세요." buttons {"취소", "이용약관 확인"} default button "이용약관 확인" cancel button "취소"' >/dev/null
/usr/bin/open 'https://chiaki.ch/en/character/chiaki'
/usr/bin/osascript -e 'display dialog "Chiaki 모델 이용약관을 읽었으며 동의하시나요? 공개 작품에는 Vocal: Chiaki 표기를 포함해야 합니다. 설치를 진행하면 로컬 파일과 로그인 항목이 생성됩니다." buttons {"취소", "동의 및 설치"} default button "동의 및 설치" cancel button "취소"' >/dev/null
"$HERE/runtime/node" "$HERE/setup.mjs" "$HERE"
