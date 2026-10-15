import { store, esc } from '../api.js';
import { MODULES, ALL_LESSONS } from '../lib/lessons.js';
import { classHistory } from './classroom.js';

const done = () => new Set(store.get('academy:done', []));
const markDone = (id) => store.set('academy:done', [...new Set([...done(), id])]);

export function renderAcademy(app) {
  const d = done();
  const total = ALL_LESSONS.length;
  const next = ALL_LESSONS.find((l) => !d.has(l.id));
  app.innerHTML = `
    <section class="page-head academy-head">
      <div>
        <h1>StockWise Academy</h1>
        <p class="lede">A free, step-by-step course from "what is a stock?" to building your own trading plan. ${total} short lessons, each with a quiz.</p>
      </div>
      <div class="card progress-card">
        <div class="label">Your progress</div>
        <div class="value">${d.size} / ${total}</div>
        <div class="progress"><span style="width:${(d.size / total) * 100}%"></span></div>
        ${next ? `<a class="btn" href="#/academy/${next.id}">${d.size ? 'Continue' : 'Start'}: ${esc(next.title)}</a>` : '<p class="up"><strong>Course complete!</strong></p>'}
      </div>
    </section>
    ${classCard()}
    <div class="modules">
      ${MODULES.map((m) => {
        const c = m.lessons.filter((l) => d.has(l.id)).length;
        return `<section class="card module">
          <div class="card-head"><h2>${esc(m.title)}</h2><span class="muted small">${c}/${m.lessons.length}</span></div>
          <p class="muted">${esc(m.blurb)}</p>
          <ol class="lesson-list">${m.lessons.map((l) => `<li class="${d.has(l.id) ? 'done' : ''}"><a href="#/academy/${l.id}">${esc(l.title)}</a> <span class="muted small">${l.minutes} min</span></li>`).join('')}</ol>
        </section>`;
      }).join('')}
    </div>`;
}

export function renderLesson(app, id) {
  const i = ALL_LESSONS.findIndex((l) => l.id === id);
  if (i < 0) { location.hash = '#/academy'; return; }
  const l = ALL_LESSONS[i];
  const prev = ALL_LESSONS[i - 1], next = ALL_LESSONS[i + 1];
  const isDone = done().has(l.id);
  app.innerHTML = `
    <nav class="crumbs"><a href="#/academy">Academy</a> › ${esc(l.module.title)}</nav>
    <article class="card lesson">
      <h1>${esc(l.title)}</h1>
      <p class="muted small">${l.minutes} min read · lesson ${i + 1} of ${ALL_LESSONS.length}</p>
      <div class="lesson-body">${l.body}</div>
    </article>
    <section class="card quiz" id="quiz">
      <h2>Quick quiz</h2>
      ${l.quiz.map((q, qi) => `
        <fieldset class="q" data-q="${qi}">
          <legend>${qi + 1}. ${esc(q.q)}</legend>
          ${q.options.map((o, oi) => `<label class="opt"><input type="radio" name="q${qi}" value="${oi}"> ${esc(o)}</label>`).join('')}
          <p class="feedback" hidden></p>
        </fieldset>`).join('')}
      <p id="quiz-result" class="${isDone ? 'up' : 'muted'}">${isDone ? '✓ Lesson complete' : 'Answer every question correctly to complete the lesson.'}</p>
    </section>
    <nav class="pager">
      ${prev ? `<a class="btn ghost" href="#/academy/${prev.id}">← ${esc(prev.title)}</a>` : '<span></span>'}
      ${next ? `<a class="btn" href="#/academy/${next.id}">${esc(next.title)} →</a>` : '<a class="btn" href="#/academy">Back to Academy</a>'}
    </nav>`;

  const quiz = app.querySelector('#quiz');
  quiz.addEventListener('change', (e) => {
    const fs = e.target.closest('fieldset');
    const q = l.quiz[Number(fs.dataset.q)];
    const ok = Number(e.target.value) === q.answer;
    fs.classList.toggle('right', ok);
    fs.classList.toggle('wrong', !ok);
    const fb = fs.querySelector('.feedback');
    fb.hidden = false;
    fb.textContent = `${ok ? 'Correct.' : 'Not quite.'} ${q.explain}`;
    const allRight = quiz.querySelectorAll('fieldset.right').length === l.quiz.length;
    if (allRight) {
      markDone(l.id);
      const r = quiz.querySelector('#quiz-result');
      r.className = 'up';
      r.textContent = '✓ Lesson complete. Nice work!';
    }
  });
}

function classCard() {
  const h = classHistory();
  const avgR = h.length ? h.reduce((t, x) => t + x.r, 0) / h.length : null;
  const wins = h.filter((x) => x.pl > 0).length;
  return `<section class="card class-promo">
    <div class="class-promo-text">
      <span class="eyebrow">Hands-on · 10 minutes</span>
      <h2>🎓 Trading Class: learn by doing</h2>
      <p>Take a real trade from start to finish on a real chart from the past (stock name hidden). Read the trend, spot the setup, place your stop and target, size the position, then live through what actually happened, one day at a time. A coach checks every decision, and every step has a <strong>Show me how</strong> button.</p>
      <a class="btn" href="#/class${h.length ? '?new=1' : ''}">${h.length ? 'Take another class trade →' : 'Start your first class →'}</a>
    </div>
    ${h.length ? `<div class="class-record">
      <div><span class="label">Class trades</span><strong>${h.length}</strong></div>
      <div><span class="label">Winners</span><strong>${wins} / ${h.length}</strong></div>
      <div><span class="label">Average result</span><strong class="${avgR >= 0 ? 'up' : 'down'}">${avgR >= 0 ? '+' : ''}${avgR.toFixed(2)}R</strong></div>
      <div><span class="label">Last checklist</span><strong>${h.at(-1).score} / 6</strong></div>
    </div>` : `<ol class="mini-steps class-outline"><li>Read the trend</li><li>Spot the setup</li><li>Place your stop-loss</li><li>Set a target</li><li>Size the position</li><li>Trade it day by day</li><li>Review your results</li></ol>`}
  </section>`;
}
