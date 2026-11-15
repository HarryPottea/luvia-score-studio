# LUVIA Score Studio

Logic Pro에서 내보낸 MusicXML 악보를 브라우저에서 열고 정리해 PDF로 저장하는 정적 웹앱입니다. 파일은 서버에 업로드되지 않습니다. 사이트 소스는 공개 저장소에 있지만 사용자가 연 파일은 브라우저 메모리에서만 처리합니다.

## 지원 범위

- 입력: `.musicxml`, `.xml`, `.mxl` (MusicXML partwise)
- 정리: 제목·작곡가·파트 이름 수정, 파트별 미리보기 표시/숨기기, 확대/축소
- 출력: 수정한 `.musicxml` 다운로드, 브라우저의 인쇄 기능으로 PDF 저장
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
