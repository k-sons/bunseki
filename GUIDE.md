# 📘 Code Bunseki — 가이드 통합 센터 (Guide Index)

> **Code Bunseki** 가이드 센터에 오신 것을 환영합니다!  
> 사용자의 숙련도와 목적에 따라 아래 두 가지 맞춤형 가이드 문서 중 하나를 선택하여 확인하실 수 있습니다.

---

## 📚 맞춤 가이드 문서 안내

### 1. 🐣 [왕초보용 100% 입문 가이드 (GUIDE_BEGINNER.md)](./GUIDE_BEGINNER.md)
**대상**: React / React Native 입문자, 코딩 초보자, 쉬운 설명이 필요한 분
- **주요 내용**:
  - 알록달록 색상 배지로 1초 만에 코드 구획 읽기 (레고 비유)
  - 좋은 코드 vs 치료가 필요한 위험한 코드 셀프 진단법
  - 구조맵/메트릭/플로우 탭 클릭을 통한 1초 코드 교차 검증법
  - 플로우 탭 상자 & 화살표(`renders`, `calls`, `calls Async`) 읽기 요령
  - 안 쓰는 헬퍼 함수 지우기 등 3분 코드 청소법
  - 잘린 조각 코드 검진 원리

---

### 2. 📘 [개발자/실무자용 메트릭 & 아키텍처 가이드 (GUIDE_PRO.md)](./GUIDE_PRO.md)
**대상**: 현업 프론트엔드 개발자, 코드 리뷰어, 아키텍처 개선 검토자
- **주요 내용**:
  - 정규식 & 뎁스 트래킹 라인 파서 엔진(`src/core/parser.js`) 구조 및 작동 원리
  - 4가지 분석 대시보드(Highlight, Structure Map, Metrics, DAG Flow) 기술 명세
  - 라인 범위(`L11–L33`) 및 마우스 호버 감지 라인 툴팁(`L25, L175`)을 활용한 Traceability 이중 검증
  - DAG 기반 플로우 엣지(`renders`, `calls`, `calls Async`) 및 비동기 부작용(Side Effect) 추적
  - God Component 감지 (라인 수 > 150, State > 5개) 및 헬퍼 함수(`Dead Code`, `Async`) 분리 전략
  - Export 마크다운 보고서를 활용한 PR 및 협업 워크플로우
