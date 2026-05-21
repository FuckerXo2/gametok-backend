// @ts-nocheck
import './styles.css';

const canvas = document.getElementById('scene-canvas');
const ctx = canvas.getContext('2d');
const chapterLabel = document.getElementById('chapter-label');
const nodeTitle = document.getElementById('node-title');
const nodeBody = document.getElementById('node-body');
const choicesEl = document.getElementById('choices');
const restartButton = document.getElementById('restart-button');
const meterOneLabel = document.getElementById('meter-one-label');
const meterTwoLabel = document.getElementById('meter-two-label');
const meterOneFill = document.getElementById('meter-one-fill');
const meterTwoFill = document.getElementById('meter-two-fill');

const THEME = {
  title: 'Choice Tide',
  hero: '#7dd3fc',
  symbol: '#fde68a',
  danger: '#fb7185',
  backgroundA: '#082f49',
  backgroundB: '#0f172a',
};

const storyNodes = {
  start: {
    chapter: 'Chapter 1',
    title: 'The Signal',
    body: 'A strange pulse crosses the dark water. Something is calling from beyond the reef.',
    choices: [
      { text: 'Follow the pulse before it fades', next: 'reef', trust: 10, risk: 15, flag: 'brave' },
      { text: 'Warn the nearby pod first', next: 'pod', trust: 20, risk: -5, flag: 'careful' },
    ],
  },
  reef: {
    chapter: 'Chapter 2',
    title: 'The Broken Reef',
    body: 'The pulse leads to cracked coral and a buried relic humming under the sand.',
    choices: [
      { text: 'Lift the relic into the open', next: 'relic', trust: 5, risk: 25, flag: 'relic' },
      { text: 'Mark the place and retreat', next: 'ending_safe', trust: 10, risk: -10, flag: 'marked' },
    ],
  },
  pod: {
    chapter: 'Chapter 2',
    title: 'The Listening Pod',
    body: 'The pod circles close. They will help, but only if you choose the route.',
    choices: [
      { text: 'Lead them through the kelp tunnel', next: 'relic', trust: 12, risk: 8, flag: 'pod_help' },
      { text: 'Send them away from danger', next: 'ending_safe', trust: 5, risk: -12, flag: 'protected_pod' },
    ],
  },
  relic: {
    chapter: 'Finale',
    title: 'The Tide Opens',
    body: 'Light pours from the relic. Your choices decide whether it becomes shelter or storm.',
    choices: [
      { text: 'Share the relic with the pod', next: 'ending_trust', trust: 20, risk: -10, flag: 'shared' },
      { text: 'Use the relic to scare away threats', next: 'ending_power', trust: -10, risk: 15, flag: 'power' },
    ],
  },
  ending_safe: {
    chapter: 'Ending',
    title: 'The Safe Current',
    body: 'The mystery waits, but the pod survives the night. Some victories are quiet.',
    ending: 'safe',
    choices: [],
  },
  ending_trust: {
    chapter: 'Ending',
    title: 'The Shared Light',
    body: 'The reef glows as the pod gathers. Trust turns the relic into a home signal.',
    ending: 'trust',
    choices: [],
  },
  ending_power: {
    chapter: 'Ending',
    title: 'The Storm Signal',
    body: 'The threats scatter, but the water remembers the force you chose.',
    ending: 'power',
    choices: [],
  },
};

const state = {
  currentNode: 'start',
  flags: {},
  meters: { trust: 45, risk: 35 },
  choices: [],
  history: [],
  ending: null,
  assets: {},
  pulse: 0,
};

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function getAssetImage(key) {
  if (!key) return null;
  const img = window.DREAM_IMAGES?.[key];
  if (img && img.complete && img.naturalWidth > 0) return img;
  return null;
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(320, Math.floor(rect.width * dpr));
  canvas.height = Math.max(200, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderScene();
}

function renderHud() {
  meterOneLabel.textContent = 'Trust';
  meterTwoLabel.textContent = 'Risk';
  meterOneFill.style.width = `${state.meters.trust}%`;
  meterTwoFill.style.width = `${state.meters.risk}%`;
}

function renderScene() {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 362;
  const height = rect.height || 280;
  const background = getAssetImage('background');
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, THEME.backgroundA);
  gradient.addColorStop(1, THEME.backgroundB);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  if (background) {
    ctx.globalAlpha = 0.38;
    ctx.drawImage(background, 0, 0, width, height);
    ctx.globalAlpha = 1;
  }

  state.pulse = (state.pulse + 0.03) % 1;
  ctx.strokeStyle = `rgba(125, 211, 252, ${0.22 + state.pulse * 0.22})`;
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i += 1) {
    ctx.beginPath();
    ctx.arc(width * 0.52, height * 0.45, 34 + i * 34 + state.pulse * 18, 0, Math.PI * 2);
    ctx.stroke();
  }

  const hero = getAssetImage('hero');
  if (hero) {
    ctx.drawImage(hero, width * 0.18, height * 0.42, 88, 88);
  } else {
    ctx.fillStyle = THEME.hero;
    ctx.beginPath();
    ctx.ellipse(width * 0.28, height * 0.64, 44, 20, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e0f2fe';
    ctx.beginPath();
    ctx.arc(width * 0.37, height * 0.59, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  const symbol = getAssetImage('symbol');
  if (symbol) {
    ctx.drawImage(symbol, width * 0.63, height * 0.47, 78, 78);
  } else {
    ctx.fillStyle = state.meters.risk > 65 ? THEME.danger : THEME.symbol;
    ctx.beginPath();
    ctx.moveTo(width * 0.72, height * 0.46);
    ctx.lineTo(width * 0.79, height * 0.62);
    ctx.lineTo(width * 0.65, height * 0.62);
    ctx.closePath();
    ctx.fill();
  }
}

function renderChoices() {
  const node = storyNodes[state.currentNode];
  state.choices = node.choices || [];
  choicesEl.innerHTML = '';
  if (state.ending) {
    restartButton.hidden = false;
    return;
  }
  restartButton.hidden = true;
  state.choices.forEach((choice, index) => {
    const button = document.createElement('button');
    button.className = 'choice';
    button.type = 'button';
    button.textContent = choice.text;
    button.addEventListener('click', () => chooseOption(index));
    choicesEl.appendChild(button);
  });
}

function applyConsequence(choice) {
  if (!choice) return;
  state.meters.trust = clamp(state.meters.trust + Number(choice.trust || 0));
  state.meters.risk = clamp(state.meters.risk + Number(choice.risk || 0));
  if (choice.flag) state.flags[choice.flag] = true;
}

function unlockNodes(choice) {
  if (!choice) return state.currentNode;
  if (choice.next === 'ending_power' && state.meters.trust > 70) return 'ending_trust';
  if (choice.next === 'ending_safe' && state.flags.brave) return 'relic';
  return choice.next || state.currentNode;
}

function chooseOption(index) {
  const node = storyNodes[state.currentNode];
  const choice = node?.choices?.[index];
  if (!choice || state.ending) return snapshot();
  state.history.push({ node: state.currentNode, choice: choice.text });
  applyConsequence(choice);
  state.currentNode = unlockNodes(choice);
  const nextNode = storyNodes[state.currentNode];
  state.ending = nextNode.ending || null;
  renderCurrentNode();
  return snapshot();
}

function renderCurrentNode() {
  const node = storyNodes[state.currentNode] || storyNodes.start;
  chapterLabel.textContent = node.chapter;
  nodeTitle.textContent = node.title;
  nodeBody.textContent = node.body;
  renderHud();
  renderScene();
  renderChoices();
}

function restartStory() {
  state.currentNode = 'start';
  state.flags = {};
  state.meters = { trust: 45, risk: 35 };
  state.choices = [];
  state.history = [];
  state.ending = null;
  renderCurrentNode();
  return snapshot();
}

function snapshot() {
  return {
    templateId: 'story-vignette',
    currentNode: state.currentNode,
    flags: { ...state.flags },
    meters: { ...state.meters },
    choiceCount: state.choices.length,
    historyLength: state.history.length,
    ending: state.ending,
  };
}

function forceEnding() {
  state.currentNode = 'ending_trust';
  state.ending = 'trust';
  state.history.push({ node: 'probe', choice: 'force ending' });
  renderCurrentNode();
  return snapshot();
}

restartButton.addEventListener('click', () => restartStory());
window.addEventListener('resize', resize);

window.__GAMETOK_TEMPLATE_PROBE__ = {
  templateId: 'story-vignette',
  snapshot,
  choose: chooseOption,
  forceEnding,
  reset: restartStory,
};

renderCurrentNode();
resize();
setInterval(renderScene, 1000 / 20);
