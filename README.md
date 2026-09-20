# oh-my-jeonseogu

디스코드 유저 "전서구"의 말투에서 영감을 받은 캐릭터와 대화하는 장난스러운 CLI.
[pi](https://github.com/badlogic/pi-mono) 하네스(`@mariozechner/pi-coding-agent`) 위에서 돌아간다.

말투 설계의 근거는 [docs/jeonseogu-style-research.md](docs/jeonseogu-style-research.md)에 있다.
실제 인물이 아니라 그 말투에서 영감을 받은 캐릭터다.

## 준비

API 키가 하나 필요하다. pi와 같은 자격증명을 쓴다:

- 대화 모드에서 `/login` 실행 (브라우저 OAuth: anthropic, github-copilot, openai-codex / 다른 provider는 API 키 입력)
- 환경변수: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` 등
- 또는 `pi` CLI 로그인으로 만든 `~/.pi/agent/auth.json`

## 설치

```sh
npm install -g oh-my-jeonseogu
```

전역 설치 후 `jeonseogu` (또는 `oh-my-jeonseogu`) 명령을 바로 쓸 수 있다.

## 실행

```sh
npm run dev           # 개발 모드 (tsx)
npm run build && npm start
```

```sh
jeonseogu                  # 대화 모드
jeonseogu "전서구야 뭐해"   # 한 번만 답하고 종료
echo "뭐해" | jeonseogu    # 파이프
```

## 옵션

| flag | 설명 |
| --- | --- |
| `-m, --model <spec>` | `provider:id`, `provider/id`, 또는 모델 id |
| `-p, --print <msg>` | 한 번 답하고 종료 |
| `-c, --continue` | 가장 최근 세션 이어하기 |
| `-e, --ephemeral` | 세션 저장 안 함 |
| `--tools` | pi 코딩 도구(read/bash/edit/write) 활성화 |
| `--think <level>` | off\|minimal\|low\|medium\|high\|xhigh |
| `--persona <path>` | 다른 페르소나 파일 사용 |
| `--no-delay` | 메시지 사이 딜레이 끄기 |

대화 중에는 `/login`(로그인), `/logout`, `/new`(새 대화), `/model`, `/models`, `/delay`, `/quit`을 쓸 수 있다.

## 동작 방식

- 모델은 한 턴의 답변을 여러 개의 채팅 메시지로 나눠 출력한다. 메시지 구분은
  `"---"`만 있는 줄이고, CLI의 `MessageSplitter`가 스트림을 실시간으로 잘라
  메시지마다 🐦 말머리를 붙여 순서대로 출력한다. 코드 펜스 안의 `---`는
  구분자로 취급하지 않는다.
- 페르소나는 [personas/jeonseogu.md](personas/jeonseogu.md) 하나에 정의돼 있고,
  커스텀 `ResourceLoader`가 skills·extensions·AGENTS.md를 전부 차단해서
  시스템 프롬프트가 페르소나만으로 구성된다.
- 기본은 순수 대화(도구 없음). `--tools`를 주면 pi의 코딩 도구가 켜진다.
- 세션은 `<cwd>/.jeonseogu/sessions/`에 저장된다(gitignore 처리됨).

## 개발

```sh
npm run check   # tsc --noEmit
npm test        # splitter/args 유닛 테스트 + mock provider E2E
```
