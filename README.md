# speech

# Discord Events Bot (BTC 변동성 트리거용 중앙은행 연설 알림)

- 공식 소스(미 연준 RSS)를 수집해서 일정 시간을 **KST**로 변환, 디스코드 채널에 **사전 알림** + **시작 알림**을 보내는 봇.
- 슬래시 등록 없이 **프리픽스 명령어**로 즉시 사용 가능.

## 기능
- `!next [시간]` : 앞으로 N시간(기본 48h) 안의 연설 목록
- `!sub fed|ecb|boe|all` : 채널 구독 설정 (MVP는 fed만 데이터 수집)
- `!unsub ...` : 구독 해제
- `!alerts 30m 1h 24h` : 사전 알림 리드 설정
- `!subs` : 채널 구독 현황 보기

## 환경 변수
- `DISCORD_TOKEN` : 디스코드 봇 토큰
- `DISCORD_CHANNEL_ID` : 알림을 보낼 채널 ID
- `PREFIX` : 프리픽스 (기본 `!`)
- `TZ` : 런타임 타임존(옵션). 서버에서 UTC 권장.

> Railway 등의 PaaS에서는 Variables에 넣고, 코드에서는 `process.env.VAR_NAME`로만 접근하세요.

## 로컬 실행
```bash
npm i
cp .env.example .env   # 값 채워넣기
npm start
