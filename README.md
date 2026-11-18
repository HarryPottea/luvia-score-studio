# JaeWoo Score Studio

Logic Pro에서 내보낸 MusicXML 악보를 브라우저에서 열고 정리해 PDF로 저장하는 정적 웹앱입니다. 파일은 서버에 업로드되지 않습니다. 사이트 소스는 공개 저장소에 있지만 사용자가 연 파일은 브라우저 메모리에서만 처리합니다.

## 지원 범위

- 입력: `.musicxml`, `.xml`, `.mxl` (MusicXML partwise)
- 정리: 제목·작곡가·파트 이름 수정, 파트별 미리보기 표시/숨기기, 확대/축소, A4 세로/가로 레이아웃 선택
- 출력: 수정한 전체 `.musicxml`, 개별 파트 `.musicxml`, **전체 파트 MusicXML ZIP** 다운로드, 전체/선택 파트를 브라우저 인쇄 기능으로 PDF 저장
- 미지원: Logic `.logicx` 직접 열기, 오디오 자동 채보, 음표/리듬 자유 편집, 재생

Logic Pro에서 **파일 > 내보내기 > 악보를 MusicXML로** 내보낸 다음 이 사이트에서 여세요. 오디오만 있는 트랙은 먼저 MIDI/노트 데이터가 필요합니다.

## 개발

```sh
npm ci
npm run dev
```

## 배포

GitHub Pages Actions 워크플로를 사용합니다. 공개 배포에는 사용자 악보 파일이 포함되지 않습니다.

악보 렌더링: [OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay). MXL 읽기: [JSZip](https://stuk.github.io/jszip/).

## 개별 파트보 출력

악보 파일을 연 다음 **파트 선택 → 선택 파트 보기 → PDF로 인쇄** 순서로 개별 파트보를 만듭니다. **전체 파트 보기**로 원래 미리보기 상태를 되돌릴 수 있습니다. 선택 파트 MusicXML 저장은 다른 악보 편집기에서 추가 편집할 때 사용합니다. 인쇄 방향은 미리보기의 **용지 방향**에서 선택하고, 브라우저 인쇄 대화상자에서도 용지 방향과 배율을 확인하세요. 이 단계는 리듬 자동 교정이나 자동 PDF 일괄 저장을 제공하지 않습니다.

## 파트별 MusicXML 일괄 다운로드

1. Logic에서 MusicXML을 내보내고 J-WOO에서 엽니다.
2. 왼쪽 **개별 파트보 → 전체 파트 MusicXML ZIP 저장**을 누릅니다.
3. 각 파트를 분리한 `.musicxml` 파일이 번호 및 파트 이름과 함께 ZIP에 저장됩니다. 이름이 같은 파트도 번호로 구분합니다.

파일은 브라우저 내부에서만 생성되며 서버에 업로드하지 않습니다. MusicXML의 리듬과 음표는 자동 교정되지 않습니다. 현재 **파트별 PDF 일괄 생성**은 지원하지 않으며, PDF는 파트를 선택한 뒤 브라우저 인쇄 기능으로 별도 저장해야 합니다.
