// src/scripts/player.ts
// 사이트 전체에서 쓰는 오디오 플레이어 1개를 관리하는 파일.
// 목록 버튼, 곡 페이지 버튼, 인트로 버튼이 모두 이 플레이어 하나를 같이 쓴다.

type State = 'idle' | 'loading' | 'playing'; // 대기 / 불러오는 중 / 재생 중
type OnState = (state: State) => void; // 상태가 바뀌면 버튼 모양을 바꿔줄 함수

// 페이드아웃 시간(밀리초). 느낌에 따라 조절 (예: 300, 600)
const FADE_MS = 400;

let audio: HTMLAudioElement;
let ready = false; // 준비를 이미 했는지
let current: HTMLElement | null = null; // 지금 곡을 고른 버튼
let onStateNow: OnState | null = null; // 그 버튼의 모양 바꾸기 함수
let switchId = 0; // 연타했을 때 마지막 버튼만 반영하기 위한 번호
let switching = false; // 곡을 바꾸는 중(페이드 + 불러오기)이면 true
let fadeTimer: ReturnType<typeof setInterval> | undefined; // 지금 돌고 있는 페이드
let canFade = true; // 볼륨 조절이 되는 기기인지 (아이폰은 안 됨)

// 처음 한 번만: 오디오 요소를 찾고, 소리 상태 알림을 연결한다
function setup() {
  if (ready) return;
  ready = true;

  // BaseLayout에 있는 <audio id="player">를 쓴다. 혹시 없으면 새로 만든다
  const found = document.querySelector<HTMLAudioElement>('#player');
  if (found) {
    audio = found;
  } else {
    audio = document.createElement('audio');
    audio.id = 'player';
    audio.preload = 'none';
    document.body.appendChild(audio);
  }

  // 이 기기가 볼륨 조절을 허락하는지 확인
  const test = new Audio();
  test.volume = 0.5;
  canFade = test.volume === 0.5;

  // 실제 소리 상태에 맞춰 버튼을 바꾼다
  audio.addEventListener('playing', () => {
    switching = false;
    onStateNow?.('playing');
  });
  audio.addEventListener('waiting', () => onStateNow?.('loading'));
  audio.addEventListener('pause', () => {
    if (!switching) onStateNow?.('idle'); // 곡 바꾸는 중의 멈춤은 무시
  });
  audio.addEventListener('error', () => {
    switching = false;
    onStateNow?.('idle');
  });
}

// 돌고 있는 페이드가 있으면 멈춘다
function stopFade() {
  if (fadeTimer !== undefined) {
    clearInterval(fadeTimer);
    fadeTimer = undefined;
  }
}

// 새 곡을 넣고 재생한다. 재생이 막히면 버튼을 원래대로 돌린다
function startTrack(owner: HTMLElement, src: string, start: number) {
  stopFade();
  audio.volume = 1;
  // 주소 끝에 #t=초 를 붙이면 브라우저가 그 지점부터 재생한다
  audio.src = start > 0 ? `${src}#t=${start}` : src;
  audio.play().catch(() => {
    if (current === owner) {
      switching = false;
      onStateNow?.('idle');
    }
  });
}

// 지금 소리를 FADE_MS 동안 서서히 줄이고, 다 줄면 done을 실행한다
// (화면 그리기와 상관없이 시계 기준으로 줄여서, 중간에 멈추지 않는다)
function fadeOut(done: () => void) {
  stopFade();
  const startVolume = audio.volume;
  const startTime = performance.now();
  fadeTimer = setInterval(() => {
    const progress = Math.min((performance.now() - startTime) / FADE_MS, 1);
    audio.volume = startVolume * (1 - progress);
    if (progress >= 1) {
      stopFade();
      audio.pause();
      done();
    }
  }, 20);
}

/**
 * 아무 버튼에서나 "이 곡 틀어줘 / 멈춰줘"를 부탁하는 문.
 * owner: 누른 버튼, src: 곡 주소, start: 시작 초, onState: 상태가 바뀔 때 버튼 모양 바꾸기
 * ※ 반드시 클릭 핸들러 안에서 바로 불러야 한다 (브라우저 소리 권한 규칙)
 */
export function toggleTrack(owner: HTMLElement, src: string, start: number, onState: OnState) {
  setup();

  // 같은 버튼을 다시 누름 → 일시정지 / 다시 재생
  if (current === owner) {
    if (switching) return; // 곡을 바꾸는 중이면 무시 (엉뚱한 곡이 끊기지 않게)
    if (audio.paused) {
      audio.play().catch(() => onState('idle'));
    } else {
      audio.pause();
    }
    return;
  }

  // 다른 버튼: 이전 버튼은 원래대로, 새 버튼은 '불러오는 중'
  onStateNow?.('idle');
  current = owner;
  onStateNow = onState;
  switching = true;
  onState('loading');
  const myId = ++switchId;

  // 아무것도 안 나오고 있거나, 볼륨 조절이 안 되는 기기 → 기다리지 않고 바로 재생
  if (audio.paused || !canFade) {
    startTrack(owner, src, start);
    return;
  }

  // 나오고 있는 곡이 있으면 → 스르륵 줄인 뒤 새 곡 재생
  fadeOut(() => {
    if (myId === switchId) startTrack(owner, src, start); // 그 사이 다른 버튼을 눌렀으면 취소
  });
}

/**
 * 목록·곡 페이지의 .play 버튼들을 플레이어에 연결하는 문.
 * 버튼에는 data-src(곡 주소), data-start(시작 초, 없으면 0)가 있어야 한다
 */
export function bindPlayButtons(selector = '.play') {
  document.querySelectorAll<HTMLButtonElement>(selector).forEach((btn) => {
    const label = btn.textContent?.trim() ?? ''; // 원래 글자 기억

    btn.addEventListener('click', () => {
      toggleTrack(btn, btn.dataset.src!, Number(btn.dataset.start ?? 0), (state) => {
        if (state === 'playing') btn.textContent = '❚❚ 일시정지';
        else if (state === 'loading') btn.textContent = '… 불러오는 중';
        else btn.textContent = label;
        btn.setAttribute('aria-pressed', String(state !== 'idle'));
        btn.setAttribute('aria-busy', String(state === 'loading'));
      });
    });
  });
}