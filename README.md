# oh-my-jeonseogu

디스코드 유저 "전서구"의 말투에서 영감을 받은 캐릭터와 대화하는 장난스러운 CLI.
실제 인물이 아니라 그 말투에서 영감을 받은 캐릭터다. 말투 설계의 근거는
[docs/jeonseogu-style-research.md](docs/jeonseogu-style-research.md)에 있다.

[pi](https://github.com/badlogic/pi-mono)의 TUI 하네스(`@mariozechner/pi-coding-agent`)를
그대로 띄우고 시스템 프롬프트만 페르소나로 교체한다. 로그인, 모델 선택, 세션 관리,
키바인딩 등은 전부 pi 네이티브다.

## 준비

API 키가 하나 필요하다. pi와 같은 자격증명을 쓴다 (~/.pi/agent/auth.json 공유):

- TUI 안에서 `/login` (브라우저 OAuth: anthropic, github-copilot, openai-codex 등)
- 환경변수: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` 등
- 또는 `pi` CLI 로그인

## 설치

```sh
npm install -g oh-my-jeonseogu
```

## 실행

```sh
jeonseogu                  # pi TUI가 페르소나로 열림
jeonseogu "전서구야 뭐해"   # 한 번만 답하고 종료 (pi --print와 동일)
```

실행하면 pi의 기본 헤더 대신 OH-MY JEONSEOGU 블록 타이포와 비둘기 ASCII 아트가 뜬다
(`src/banner.ts`에서 확장 팩토리로 헤더를 교체). `--print` 등 비대화 모드에서는 안 뜬다.

모든 pi 플래그가 그대로 통한다 (`--model`, `-c/--continue`, `--no-session`,
`--thinking`, `-e <path>` 등). `jeonseogu --help`는 pi의 도움말과 같다.

전서구 전용 플래그는 하나뿐이다: `--persona <path>` (다른 페르소나 파일 사용).

## 기본값

플래그 없이 실행하면 아래가 자동으로 주입된다:

| 주입되는 pi 플래그 | 의미 | 해제 방법 |
| --- | --- | --- |
| `--system-prompt <페르소나>` | 시스템 프롬프트를 페르소나로 교체 | `--system-prompt`/`--append-system-prompt`를 직접 전달 |
| `--no-tools` | 순수 대화 (코딩 도구 끔) | `--tools read,bash,...` 등 pi의 도구 플래그를 직접 전달 |
| `--no-extensions --no-skills` | 사용자 pi 설정에서 확장/스킬 유입 차단 | `--extension`/`--skill`로 명시적 지정 |
| `--no-context-files` | cwd의 AGENTS.md/CLAUDE.md 유입 차단 | 없음 (페르소나 순수성 유지용) |

## 동작 방식

- `src/cli.ts`는 60줄짜리 얇은 래퍼다. argv를 매핑한 뒤 pi 패키지의 `main()`을
  그대로 호출하고, 프록시/타임아웃 처리도 pi의 `cli.js` 프리앰블을 그대로 따른다.
- 페르소나는 [personas/jeonseogu.md](personas/jeonseogu.md) 하나에 정의돼 있다.
  캐릭터는 답변을 `"---"` 줄로 나눠 여러 메시지처럼 보내는데, pi TUI에서는
  하나의 응답 안에 구분선으로 렌더링된다.
- 세션은 pi와 같은 위치(`~/.pi/agent/sessions`)에 저장되므로 `-c`/`--resume`이
  pi 세션 피커와 호환된다.

## 개발

```sh
npm run dev      # tsx로 바로 실행
npm run check    # tsc --noEmit
npm test         # argv 매핑 유닛 테스트
```
