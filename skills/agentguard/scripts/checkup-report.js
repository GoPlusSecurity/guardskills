#!/usr/bin/env node

/**
 * GoPlus AgentGuard — Checkup Report Generator
 *
 * Reads checkup results as JSON from stdin, generates a self-contained HTML
 * report with lobster mascot and opens it in the default browser.
 *
 * Usage:
 *   echo '{"composite_score":73,...}' | node scripts/checkup-report.js
 *
 * Output: prints the generated HTML file path to stdout.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Try to load favicon from agentguard-server or fallback
const __dirname = dirname(fileURLToPath(import.meta.url));
let faviconB64 = '';
const iconPaths = [
  join(homedir(), 'code/agentguard-server/public/icon-192.png'),
  join(__dirname, '../../assets/icon-192.png'),
];
for (const p of iconPaths) {
  if (existsSync(p)) { faviconB64 = readFileSync(p).toString('base64'); break; }
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try { generateReport(JSON.parse(input)); }
  catch (err) { process.stderr.write(`Error: ${err.message}\n`); process.exit(1); }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTier(score) {
  if (score >= 90) return { grade: 'S', label: 'JACKED', color: '#00ffa3', quote: "Your agent is JACKED! 💪 Nothing gets past these claws!" };
  if (score >= 70) return { grade: 'A', label: 'Healthy', color: '#98cbff', quote: "Looking solid! A few tweaks and you'll be unstoppable." };
  if (score >= 50) return { grade: 'B', label: 'Tired', color: '#f0a830', quote: "Your agent needs a workout... and maybe some coffee. ☕" };
  return { grade: 'F', label: 'Critical', color: '#ffb4ab', quote: "CRITICAL CONDITION! This agent needs emergency care! 🚨" };
}

const DIM_META = {
  code_safety:          { icon: 'find_in_page', name: 'Skill & Code Safety' },
  credential_safety:    { icon: 'key',          name: 'Credential & Secrets' },
  network_exposure:     { icon: 'lan',          name: 'Network & System' },
  runtime_protection:   { icon: 'shield',       name: 'Runtime Protection' },
  web3_safety:          { icon: 'token',        name: 'Web3 Safety' },
};

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function sevColor(s) {
  s = (s||'').toUpperCase();
  if (s === 'CRITICAL') return '#ffb4ab';
  if (s === 'HIGH') return '#f0a830';
  if (s === 'MEDIUM') return '#98cbff';
  return '#849588';
}

function dimColor(score) {
  if (score === null) return '#849588';
  if (score >= 90) return '#00ffa3';
  if (score >= 70) return '#00a2fd';
  if (score >= 50) return '#f0a830';
  return '#ffb4ab';
}

// ---------------------------------------------------------------------------
// Pixel-art lobster SVG (inline, no external deps)
// ---------------------------------------------------------------------------
function pixelLobster(grade, color) {
  const R = '#e63946', R2 = '#d62839', R3 = '#c1121f', R4 = '#a30d1a'; // healthy reds
  const P1 = '#c4737b', P2 = '#a8636b', P3 = '#8a3040'; // pale/sick

  const styles = `<style>
@keyframes pxBounce{0%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}
@keyframes pxBreath{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.02)}}
@keyframes pxSp{0%,100%{opacity:1}50%{opacity:.1}}
@keyframes pxBl{0%,92%,96%,100%{transform:scaleY(1)}94%{transform:scaleY(.05)}}
@keyframes pxSw{0%{opacity:.8;transform:translateY(0)}100%{opacity:0;transform:translateY(5px)}}
@keyframes pxSteam{0%{opacity:.4;transform:translateY(0)}100%{opacity:0;transform:translateY(-4px)}}
@keyframes pxAlarm{0%,100%{opacity:1}50%{opacity:.1}}
@keyframes pxFlex{0%,100%{transform:rotate(0)}25%{transform:rotate(-20deg)}75%{transform:rotate(5deg)}}
@keyframes pxFlexR{0%,100%{transform:rotate(0)}25%{transform:rotate(20deg)}75%{transform:rotate(-5deg)}}
@keyframes pxWag{0%,100%{transform:rotate(0)}50%{transform:rotate(6deg)}}
@keyframes pxNod{0%,100%{transform:translateY(0)}50%{transform:translateY(1px)}}
@keyframes pxCoffee{0%,100%{transform:rotate(0)}30%{transform:rotate(-10deg)}70%{transform:rotate(3deg)}}
@keyframes pxTremor{0%,100%{transform:translate(0,0)}25%{transform:translate(-1px,0)}50%{transform:translate(1px,-1px)}75%{transform:translate(-1px,1px)}}
.px-bounce{animation:pxBounce 2s ease-in-out infinite}
.px-breath{animation:pxBreath 3s ease-in-out infinite;transform-origin:bottom}
.px-sparkle{animation:pxSp 1.3s ease-in-out infinite}
.px-blink{animation:pxBl 4s ease-in-out infinite;transform-origin:center}
.px-sweat{animation:pxSw 1.6s ease-in infinite}
.px-steam{animation:pxSteam 2s ease-out infinite}
.px-alarm{animation:pxAlarm .6s ease-in-out infinite}
.px-flex-l{animation:pxFlex 2.2s ease-in-out infinite;transform-origin:right center}
.px-flex-r{animation:pxFlexR 2.2s ease-in-out infinite;transform-origin:left center}
.px-wag{animation:pxWag 1.8s ease-in-out infinite;transform-origin:top center}
.px-nod{animation:pxNod 2.5s ease-in-out infinite}
.px-coffee{animation:pxCoffee 3s ease-in-out infinite;transform-origin:bottom left}
.px-tremor{animation:pxTremor .25s linear infinite}
</style>`;

  // Helper: draw a filled rect shorthand
  const px = (x,y,w,h,c) => `<rect x="${x}" y="${y}" width="${w||1}" height="${h||1}" fill="${c}"/>`;

  // ── S TIER: Jacked lobster with crown ──
  if (grade === 'S') return `<svg viewBox="-2 -8 52 56" xmlns="http://www.w3.org/2000/svg">${styles}
<g class="px-bounce">
  <!-- Long antennae (waving) -->
  <g class="px-wag">${px(14,0,1,1,R)}${px(13,1,1,1,R)}${px(12,2,1,1,R2)}${px(12,3,1,1,R2)}${px(13,4,1,1,R)}</g>
  <g class="px-wag" style="animation-delay:.5s">${px(33,0,1,1,R)}${px(34,1,1,1,R)}${px(35,2,1,1,R2)}${px(35,3,1,1,R2)}${px(34,4,1,1,R)}</g>
  <!-- Crown -->
  <g class="px-wag" style="animation-duration:2.5s">${px(18,2,1,2,'#ffd700')}${px(21,1,1,2,'#ffd700')}${px(24,0,1,2,'#ffd700')}${px(27,1,1,2,'#ffd700')}${px(30,2,1,2,'#ffd700')}${px(17,4,14,1,'#ffd700')}${px(17,5,14,1,'#e6c200')}</g>
  <!-- Sparkles -->
  ${px(10,1,1,1,'#fffbe6')} ${px(37,2,1,1,'#fffbe6')}
  <rect x="8" y="8" width="1" height="1" fill="#ffd700" class="px-sparkle" style="animation-delay:0s"/>
  <rect x="39" y="7" width="1" height="1" fill="#ffd700" class="px-sparkle" style="animation-delay:.4s"/>
  <rect x="5" y="14" width="1" height="1" fill="#fffbe6" class="px-sparkle" style="animation-delay:.8s"/>
  <rect x="42" y="13" width="1" height="1" fill="#fffbe6" class="px-sparkle" style="animation-delay:1.2s"/>
  <!-- Head -->
  <g class="px-nod">${px(18,6,12,6,R)}${px(17,7,14,5,R)}${px(16,8,16,3,R)}
    <!-- Sunglasses -->
    ${px(19,9,4,3,'#1a1a2e')}${px(25,9,4,3,'#1a1a2e')}${px(23,10,2,1,'#1a1a2e')}
    ${px(20,10,2,1,color+'88')}${px(26,10,2,1,color+'88')}
    <!-- Grin -->
    ${px(20,13,1,1,'#fff')}${px(21,13,6,1,R3)}${px(27,13,1,1,'#fff')}
  </g>
  <!-- Body (breathing + segments) -->
  <g class="px-breath">${px(17,14,14,3,R)}${px(16,15,16,2,R2)}
    ${px(18,17,12,2,R)}${px(17,18,14,1,R2)}
    ${px(19,19,10,2,R2)}${px(18,20,12,1,R3)}
    <!-- Abs -->
    ${px(21,15,2,1,R3)}${px(25,15,2,1,R3)}${px(21,18,2,1,R3)}${px(25,18,2,1,R3)}
  </g>
  <!-- Left claw (flexing) -->
  <g class="px-flex-l">${px(8,9,4,3,R)}${px(6,10,3,4,R)}${px(4,9,3,3,R2)}
    ${px(3,8,2,2,R)}${px(2,7,2,1,R)}${px(5,8,1,1,R3)}
    ${px(3,12,2,1,R3)}${px(2,11,1,2,R)}
  </g>
  <!-- Right claw (flexing) -->
  <g class="px-flex-r" style="animation-delay:.3s">${px(36,9,4,3,R)}${px(39,10,3,4,R)}${px(41,9,3,3,R2)}
    ${px(43,8,2,2,R)}${px(44,7,2,1,R)}${px(42,8,1,1,R3)}
    ${px(43,12,2,1,R3)}${px(45,11,1,2,R)}
  </g>
  <!-- Walking legs (4 pairs) -->
  ${px(15,20,1,3,R2)}${px(14,22,1,2,R3)}
  ${px(17,21,1,3,R2)}${px(16,23,1,2,R3)}
  ${px(30,21,1,3,R2)}${px(31,23,1,2,R3)}
  ${px(32,20,1,3,R2)}${px(33,22,1,2,R3)}
  <!-- Fan tail (wagging) -->
  <g class="px-wag">${px(20,22,8,2,R3)}${px(19,24,10,1,R3)}${px(18,25,3,2,R4)}${px(22,25,4,2,R3)}${px(27,25,3,2,R4)}${px(17,27,3,1,R4)}${px(21,27,6,1,R3)}${px(28,27,3,1,R4)}</g>
</g></svg>`;

  // ── A TIER: Healthy lobster with shield ──
  if (grade === 'A') return `<svg viewBox="-2 -8 52 54" xmlns="http://www.w3.org/2000/svg">${styles}
<g class="px-bounce" style="animation-duration:2.2s">
  <!-- Antennae (long, waving) -->
  <g class="px-wag">${px(15,0,1,1,R)}${px(14,1,1,1,R)}${px(13,2,1,2,R2)}${px(14,4,1,1,R)}</g>
  <g class="px-wag" style="animation-delay:.4s">${px(32,0,1,1,R)}${px(33,1,1,1,R)}${px(34,2,1,2,R2)}${px(33,4,1,1,R)}</g>
  <!-- Eye stalks -->
  ${px(17,4,2,2,R2)}${px(29,4,2,2,R2)}
  <!-- Head -->
  <g class="px-nod" style="animation-duration:3s">${px(18,5,12,5,R)}${px(17,6,14,4,R)}${px(16,7,16,2,R)}
    <!-- Eyes (blinking) -->
    <g class="px-blink">${px(20,7,3,2,'#fff')}${px(25,7,3,2,'#fff')}</g>
    ${px(21,8,1,1,'#1a1a2e')}${px(26,8,1,1,'#1a1a2e')}
    <!-- Smile -->
    ${px(21,10,1,1,R3)}${px(22,11,4,1,R3)}${px(26,10,1,1,R3)}
  </g>
  <!-- Body segments (breathing) -->
  <g class="px-breath" style="animation-duration:3.5s">${px(17,12,14,3,R)}${px(16,13,16,2,R2)}
    ${px(18,15,12,2,R)}${px(17,16,14,1,R2)}
    ${px(19,17,10,2,R2)}
  </g>
  <!-- Left claw -->
  ${px(8,8,4,3,R)}${px(6,9,3,3,R)}${px(4,8,3,2,R2)}${px(3,7,2,2,R)}${px(3,10,2,1,R3)}
  <!-- Right claw + Shield (bobbing) -->
  <g class="px-wag" style="animation-duration:2s">${px(36,8,4,3,R)}${px(38,9,3,3,R)}${px(40,8,3,2,R2)}
    ${px(40,6,5,6,color)}${px(41,7,3,4,color+'cc')}${px(42,8,2,2,'#fff')}
  </g>
  <!-- Walking legs -->
  ${px(15,18,1,3,R2)}${px(14,20,1,2,R3)}${px(17,19,1,3,R2)}${px(16,21,1,2,R3)}
  ${px(30,19,1,3,R2)}${px(31,21,1,2,R3)}${px(32,18,1,3,R2)}${px(33,20,1,2,R3)}
  <!-- Fan tail -->
  <g class="px-wag" style="animation-duration:2.5s">${px(20,20,8,2,R3)}${px(19,22,10,1,R3)}${px(18,23,3,2,R4)}${px(22,23,4,2,R3)}${px(27,23,3,2,R4)}</g>
</g></svg>`;

  // ── B TIER: Tired lobster with coffee ──
  const T1 = '#d4545e', T2 = '#c1454f', T3 = '#a1101a';
  if (grade === 'B') return `<svg viewBox="-2 -8 52 52" xmlns="http://www.w3.org/2000/svg">${styles}
<g class="px-bounce" style="animation-duration:3.5s">
  <!-- Droopy antennae -->
  ${px(14,3,1,1,T2)}${px(13,4,1,2,T2)}${px(14,6,1,1,T2)}
  ${px(33,3,1,1,T2)}${px(34,4,1,2,T2)}${px(33,6,1,1,T2)}
  <!-- Sweat -->
  <rect x="35" y="4" width="1" height="1" fill="#58a6ff" class="px-sweat" style="animation-delay:0s"/>
  <rect x="36" y="6" width="1" height="1" fill="#58a6ff" class="px-sweat" style="animation-delay:.6s"/>
  <rect x="12" y="5" width="1" height="1" fill="#58a6ff" class="px-sweat" style="animation-delay:1.2s"/>
  <!-- Head (sleepy nod) -->
  <g class="px-nod" style="animation-duration:4s">${px(18,6,12,5,T1)}${px(17,7,14,4,T1)}${px(16,8,16,2,T1)}
    <!-- Sleepy eyes -->
    ${px(20,8,3,2,'#fff')}${px(25,8,3,2,'#fff')}
    <g class="px-blink" style="animation-duration:2s">${px(20,8,3,1,T1)}${px(25,8,3,1,T1)}</g>
    ${px(21,9,1,1,'#1a1a2e')}${px(26,9,1,1,'#1a1a2e')}
    <!-- Flat mouth -->
    ${px(22,11,4,1,T3)}
  </g>
  <!-- Body -->
  <g class="px-breath" style="animation-duration:4s">${px(17,12,14,3,T1)}${px(16,13,16,2,T2)}${px(18,15,12,2,T1)}${px(19,17,10,2,T2)}</g>
  <!-- Left claw (limp) -->
  ${px(8,10,4,3,T1)}${px(6,11,3,2,T2)}${px(4,10,3,2,T2)}${px(3,11,2,1,T1)}
  <!-- Right claw + coffee cup (sipping) -->
  <g class="px-coffee">${px(36,10,4,3,T1)}${px(38,11,3,2,T2)}
    ${px(39,8,4,5,'#8b6914')}${px(38,8,6,1,'#a07818')}
    <rect x="40" y="5" width="1" height="3" fill="#ffffff30" class="px-steam" style="animation-delay:0s"/>
    <rect x="41" y="4" width="1" height="3" fill="#ffffff20" class="px-steam" style="animation-delay:.8s"/>
    <rect x="39" y="5" width="1" height="2" fill="#ffffff15" class="px-steam" style="animation-delay:1.5s"/>
  </g>
  <!-- Walking legs -->
  ${px(15,18,1,3,T2)}${px(14,20,1,2,T3)}${px(17,19,1,3,T2)}${px(16,21,1,2,T3)}
  ${px(30,19,1,3,T2)}${px(31,21,1,2,T3)}${px(32,18,1,3,T2)}${px(33,20,1,2,T3)}
  <!-- Fan tail -->
  ${px(20,20,8,2,T3)}${px(19,22,10,1,T3)}${px(18,23,3,1,T3)}${px(22,23,4,1,T3)}${px(27,23,3,1,T3)}
</g></svg>`;

  // ── F TIER: Sick lobster trembling ──
  return `<svg viewBox="-2 -8 52 52" xmlns="http://www.w3.org/2000/svg">${styles}
<g class="px-tremor">
  <!-- Alarm lights -->
  <rect x="4" y="7" width="2" height="2" fill="#f85149" class="px-alarm" style="animation-delay:0s"/>
  <rect x="42" y="6" width="2" height="2" fill="#f85149" class="px-alarm" style="animation-delay:.3s"/>
  <rect x="2" y="13" width="1" height="1" fill="#f85149" class="px-alarm" style="animation-delay:.6s"/>
  <rect x="45" y="12" width="1" height="1" fill="#f85149" class="px-alarm" style="animation-delay:.9s"/>
  <!-- Wilted antennae -->
  ${px(14,5,1,1,P2)}${px(13,6,1,1,P2)}${px(33,5,1,1,P2)}${px(34,6,1,1,P2)}
  <!-- Head (shaking) + bandage -->
  ${px(18,6,12,5,P1)}${px(17,7,14,4,P1)}${px(16,8,16,2,P1)}
  <!-- Bandage cross on head -->
  ${px(20,5,8,1,'#fff')}${px(23,4,2,3,'#fff')}${px(23,5,2,1,'#e63946')}
  <!-- X_X eyes -->
  ${px(20,8,1,1,'#e63946')}${px(22,8,1,1,'#e63946')}${px(21,9,1,1,'#e63946')}${px(20,10,1,1,'#e63946')}${px(22,10,1,1,'#e63946')}
  ${px(26,8,1,1,'#e63946')}${px(28,8,1,1,'#e63946')}${px(27,9,1,1,'#e63946')}${px(26,10,1,1,'#e63946')}${px(28,10,1,1,'#e63946')}
  <!-- Thermometer -->
  ${px(29,11,6,1,'#58a6ff')}${px(35,10,2,3,'#f85149')}
  <!-- Sad mouth -->
  ${px(22,12,1,1,P3)}${px(23,11,2,1,P3)}${px(25,12,1,1,P3)}
  <!-- Body (weak breathing) + bandages -->
  <g class="px-breath" style="animation-duration:5s">${px(17,13,14,3,P1)}${px(16,14,16,2,P2)}${px(18,16,12,2,P1)}${px(19,18,10,2,P2)}
    ${px(16,14,10,1,'#ffffff30')}${px(18,17,8,1,'#ffffff30')}
  </g>
  <!-- Limp claws -->
  ${px(8,13,4,2,P1)}${px(6,14,3,2,P2)}${px(4,15,3,1,P2)}
  ${px(36,13,4,2,P1)}${px(38,14,3,2,P2)}${px(41,15,3,1,P2)}
  <!-- Weak legs -->
  ${px(15,19,1,2,P2)}${px(14,20,1,2,P3)}${px(17,19,1,2,P2)}${px(16,20,1,2,P3)}
  ${px(30,19,1,2,P2)}${px(31,20,1,2,P3)}${px(32,19,1,2,P2)}${px(33,20,1,2,P3)}
  <!-- Tail (limp) -->
  ${px(20,20,8,2,P3)}${px(19,22,10,1,P3)}${px(18,23,3,1,P3)}${px(22,23,4,1,P3)}${px(27,23,3,1,P3)}
</g></svg>`;
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

function generateReport(data) {
  const { composite_score = 0, dimensions = {}, recommendations = [], skills_scanned = 0, protection_level = 'unknown', timestamp } = data;
  const tier = getTier(composite_score);
  const ctaUrl = `https://agentguard.gopluslabs.io?utm_source=checkup&utm_medium=cli&utm_campaign=health_report&score=${composite_score}`;
  const ts = timestamp || new Date().toISOString();
  const totalFindings = Object.values(dimensions).reduce((s, d) => s + (d.findings || []).length, 0);
  const lobsterSvg = pixelLobster(tier.grade, tier.color);

  // ── Page 1: Dimension rows ──
  const dimRowsHtml = Object.entries(DIM_META).map(([key, meta]) => {
    const dim = dimensions[key] || { score: null, na: false };
    const score = dim.na ? null : (dim.score ?? null);
    const color = dimColor(score);
    const pct = score !== null ? score : 0;
    const isNA = score === null;
    const opacity = isNA ? 'opacity-40 grayscale' : '';
    return `
    <div class="bg-[#262a31]/30 p-4 rounded-lg border border-[#3a4a3f]/10 hover:bg-[#262a31]/50 transition-all ${opacity}">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-3">
          <span class="material-symbols-outlined" style="color:${color}">${meta.icon}</span>
          <span class="font-headline font-medium text-[#dfe2eb]">${meta.name}</span>
        </div>
        <span class="font-headline font-bold" style="color:${color}">${isNA ? '--' : score}</span>
      </div>
      <div class="w-full h-1 bg-[#0a0e14] rounded-full overflow-hidden">
        <div class="h-full rounded-full transition-all duration-1000" style="background:${color};width:${pct}%${!isNA ? `;box-shadow:0 0 8px ${color}` : ''}"></div>
      </div>
    </div>`;
  }).join('\n');

  // ── Findings data ──
  const allFindings = [];
  const cleanDims = [];
  for (const [key, meta] of Object.entries(DIM_META)) {
    const fs = dimensions[key]?.findings || [];
    if (fs.length === 0) cleanDims.push(meta);
    for (const f of fs) allFindings.push({ ...f, icon: meta.icon, dim: meta.name });
  }
  allFindings.sort((a, b) => {
    const o = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return (o[(a.severity||'MEDIUM').toUpperCase()]||3) - (o[(b.severity||'MEDIUM').toUpperCase()]||3);
  });

  // Split findings into pages of 3
  const FPP = 3;
  const findingsPages = [];
  if (allFindings.length > 0) {
    for (let i = 0; i < allFindings.length; i += FPP) {
      const chunk = allFindings.slice(i, i + FPP);
      const isFirst = i === 0;
      const isLast = i + FPP >= allFindings.length;
      let h = '';
      if (isFirst) {
        h += `<div class="mb-6"><p class="text-xs font-label uppercase tracking-[0.2em] text-[#849588] mb-1">Active Vulnerability Stream</p><h1 class="text-3xl font-headline font-bold text-[#f5fff5] tracking-tight flex items-center gap-3"><span class="material-symbols-outlined text-[#ffb4ab]">bug_report</span>Findings <span class="text-[#849588] font-normal text-lg">(${totalFindings})</span></h1></div>`;
      } else {
        h += `<div class="mb-6 flex items-center gap-3"><span class="material-symbols-outlined text-[#ffb4ab]">bug_report</span><span class="text-lg font-headline font-bold text-[#849588]">Findings — ${i+1}–${Math.min(i+FPP,allFindings.length)} of ${totalFindings}</span></div>`;
      }
      h += chunk.map(f => {
        const sev = (f.severity||'MEDIUM').toUpperCase();
        const sc = sevColor(sev);
        return `
        <div class="bg-[#1c2026] border border-[#3a4a3f]/15 rounded-xl p-5 mb-3" style="border-left:3px solid ${sc}">
          <div class="flex items-center gap-3 mb-2">
            <span class="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide text-white" style="background:${sc}">${sev}</span>
            <span class="flex items-center gap-1.5 font-headline font-medium text-[#dfe2eb]"><span class="material-symbols-outlined text-base" style="color:${sc}">${f.icon}</span>${f.dim}</span>
          </div>
          <p class="text-sm text-[#b9cbbd] leading-relaxed">${esc(f.text||f.description||'')}</p>
        </div>`;
      }).join('');
      if (isLast && cleanDims.length > 0) {
        h += `<div class="bg-[#1c2026] border border-[#3a4a3f]/15 rounded-xl p-8 mt-3 text-center"><span class="material-symbols-outlined text-4xl text-[#849588]/40 mb-2">verified_user</span><p class="font-headline font-bold text-[#dfe2eb] mb-1">${cleanDims.map(d=>d.name).join(', ')}</p><p class="text-sm text-[#849588]">No active threats detected. Clinically sterile.</p></div>`;
      }
      findingsPages.push(h);
    }
  } else {
    let h = `<div class="mb-6"><h1 class="text-3xl font-headline font-bold text-[#f5fff5] tracking-tight flex items-center gap-3"><span class="material-symbols-outlined text-[#00ffa3]">verified_user</span>Findings <span class="text-[#849588] font-normal text-lg">(0)</span></h1></div>`;
    h += `<div class="bg-[#1c2026] border border-[#3a4a3f]/15 rounded-xl p-12 text-center"><span class="material-symbols-outlined text-5xl text-[#00ffa3]/40 mb-3">shield</span><p class="text-xl font-headline font-bold text-[#dfe2eb] mb-2">All Clear</p><p class="text-sm text-[#849588]">No active threats detected across all dimensions.</p></div>`;
    findingsPages.push(h);
  }

  // ── Recommendations ──
  // Auto-generate extra recommendations based on dimension scores
  const autoRecs = [];
  const ds = dimensions;
  if (ds.code_safety && !ds.code_safety.na && (ds.code_safety.score ?? 100) < 70)
    autoRecs.push({ severity: 'HIGH', text: 'Run /agentguard scan on all installed skills and review flagged findings.' });
  if (ds.trust_hygiene && !ds.trust_hygiene.na && (ds.trust_hygiene.score ?? 100) < 70)
    autoRecs.push({ severity: 'HIGH', text: 'Register unattested skills with /agentguard trust attest after security review.' });
  if (ds.runtime_defense && !ds.runtime_defense.na && (ds.runtime_defense.score ?? 100) < 50)
    autoRecs.push({ severity: 'MEDIUM', text: 'Enable guard hooks to build a security audit trail and block threats in real-time.' });
  if (ds.secret_protection && !ds.secret_protection.na && (ds.secret_protection.score ?? 100) < 70)
    autoRecs.push({ severity: 'CRITICAL', text: 'Rotate exposed credentials and fix file permissions on ~/.ssh/ and ~/.gnupg/ directories.' });
  if (ds.web3_shield && !ds.web3_shield.na && (ds.web3_shield.score ?? 100) < 50)
    autoRecs.push({ severity: 'HIGH', text: 'Configure GOPLUS_API_KEY for enhanced Web3 transaction simulation and phishing detection.' });
  if (ds.config_posture && !ds.config_posture.na && (ds.config_posture.score ?? 100) < 50)
    autoRecs.push({ severity: 'MEDIUM', text: 'Switch protection level to balanced or strict: /agentguard config balanced' });
  if (ds.config_posture && !ds.config_posture.na && (ds.config_posture.score ?? 100) < 70)
    autoRecs.push({ severity: 'LOW', text: 'Set up daily security patrols for continuous posture monitoring: /agentguard patrol setup' });
  if (composite_score < 90)
    autoRecs.push({ severity: 'LOW', text: 'Enable auto-scan on session start: export AGENTGUARD_AUTO_SCAN=1' });

  // Merge: user recs first, then auto recs (dedup by text similarity)
  const allRecs = [...recommendations];
  for (const ar of autoRecs) {
    if (!allRecs.some(r => r.text.toLowerCase().includes(ar.text.slice(0, 30).toLowerCase()))) {
      allRecs.push(ar);
    }
  }
  // Always add premium CTA as last
  if (!allRecs.some(r => r.text.toLowerCase().includes('premium'))) {
    allRecs.push({ severity: 'LOW', text: 'Upgrade to GoPlus AgentGuard Premium for 24/7 real-time monitoring, automated alerts, and team security dashboard.' });
  }

  const recsHtml = allRecs.length > 0
    ? `<div class="space-y-1">${allRecs.map((r, i) => {
      const sev = (r.severity||'MEDIUM').toUpperCase();
      const sc = sevColor(sev);
      return `
      <div class="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-[#262a31]/30 transition-colors group">
        <span class="w-5 text-xs font-headline font-bold text-[#849588]/60">${i+1}</span>
        <span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide text-white shrink-0" style="background:${sc}">${sev}</span>
        <span class="text-sm text-[#b9cbbd] leading-snug">${esc(r.text)}</span>
        <span class="material-symbols-outlined text-sm text-[#849588]/0 group-hover:text-[#849588]/50 transition-colors ml-auto shrink-0">chevron_right</span>
      </div>`;
    }).join('')}</div>`
    : '<div class="text-center py-12 text-[#849588]">No recommendations.</div>';

  // ── AI Analysis report ──
  const analysisText = data.analysis || '';
  const analysisHtml = analysisText
    ? `<div class="relative group">
        <div class="bg-[#0a0e14] border border-[#3a4a3f]/10 rounded-xl p-5 text-sm text-[#b9cbbd] leading-relaxed whitespace-pre-line" id="analysisText">${esc(analysisText)}</div>
        <button onclick="copyReport()" id="copyBtn" class="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 bg-[#262a31] border border-[#3a4a3f]/30 rounded-lg text-[11px] font-semibold text-[#849588] hover:text-[#dfe2eb] hover:border-[#849588]/50 transition-all opacity-0 group-hover:opacity-100">
          <span class="material-symbols-outlined text-sm" id="copyIcon">content_copy</span><span id="copyLabel">Copy Report</span>
        </button>
      </div>`
    : '';

  // ── Health status label ──
  const healthLabel = composite_score >= 70 ? 'OPTIMAL' : composite_score >= 50 ? 'STABILIZING' : 'CRITICAL_ALERT';

  // ── Total pages ──
  const totalPages = 1 + findingsPages.length + 1;

  const html = `<!DOCTYPE html>
<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width,initial-scale=1.0" name="viewport"/>
<title>AgentGuard Diagnostic Report — ${composite_score}/100</title>
${faviconB64 ? `<link rel="icon" type="image/png" href="data:image/png;base64,${faviconB64}"/>` : ''}
<meta property="og:title" content="AgentGuard Security Report — Score: ${composite_score}/100"/>
<meta property="og:description" content="Tier ${tier.grade} — ${tier.label}. ${totalFindings} findings across ${skills_scanned} skills."/>
<meta name="twitter:card" content="summary"/>
<meta name="twitter:title" content="AgentGuard Security Report — ${composite_score}/100"/>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"><\/script>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
<script>
tailwind.config={darkMode:"class",theme:{extend:{colors:{"primary-container":"${tier.color}","surface-container":"#1c2026"},fontFamily:{"headline":["Space Grotesk"],"body":["Inter"],"label":["Inter"]}}}};
<\/script>
<style>
body{background:#0a0e14;color:#dfe2eb;font-family:'Inter',sans-serif}
.obsidian-layer{background:linear-gradient(145deg,#1c2026 0%,#12171e 100%)}
.material-symbols-outlined{font-variation-settings:'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24}
</style>
</head>
<body class="h-screen overflow-hidden flex flex-col">

<!-- Header -->
<header class="shrink-0 flex justify-between items-center px-6 py-3 bg-[#10141a] shadow-[0px_8px_24px_rgba(0,0,0,0.3)]">
  <div class="text-lg font-bold text-[#f5fff5] flex items-center gap-2 font-['Space_Grotesk'] tracking-tight">
    <svg viewBox="0 0 540 540" width="24" height="24" class="shrink-0"><rect fill="#151515" width="540" height="540" rx="73"/><g transform="translate(127.125,136.125)" fill="#fff" fill-rule="nonzero"><path d="M188.93 65.32V65.34H116.13C70.82 65.34 34.09 102.86 34.09 149.14c0 46.28 36.73 83.8 82.04 83.8h9.24 8.67 35.53c9.1 0 16.47-7.53 16.47-16.82s-7.37-16.82-16.47-16.82h-34.95-.58-11.56c-29.98 0-54.31-22.32-54.31-50.01 0-27.69 24.33-50.37 54.31-50.37l36.87.12c0-.02 0-.04 0-.07h45.74c0 19.56-16.92 35.42-37.77 35.42-.7 0-1.36-.02-1.98-.05v.05H117c-8.14 0-14.73 6.74-14.73 15.05 0 8.31 6.6 15.05 14.73 15.05h14.16 2.89.58 34.95c27.92 0 50.56 23.12 50.56 51.63 0 28.52-22.63 51.64-50.56 51.64h-35.53-17.91C52 267.75 0 214.64 0 149.14 0 83.63 52 30.52 116.13 30.52h38.13 34.67 33.51c0 19.03-14.95 34.49-33.51 34.8M314.97 48.32h-20.14V70.13c0 1.87-1.53 3.39-3.41 3.39h-18.18c-1.88 0-3.41-1.52-3.41-3.39V48.32h-19.64c-1.88 0-3.41-1.52-3.41-3.39V28.53c0-1.87 1.53-3.39 3.41-3.39h19.64V3.39C269.83 1.52 271.35 0 273.23 0h18.18c1.88 0 3.41 1.52 3.41 3.39v21.74h20.14c1.88 0 3.41 1.52 3.41 3.39v16.4c0 1.87-1.53 3.39-3.41 3.39"/></g></svg>
    AgentGuard Report
  </div>
  <div class="flex items-center gap-3">
    <span class="text-[#849588] text-xs font-['Space_Grotesk'] tracking-[0.15em] uppercase">${protection_level} mode</span>
    <span class="text-[#849588] text-xs">${ts.slice(0,10)}</span>
    <button onclick="shareReport()" class="flex items-center gap-1.5 px-3 py-1.5 bg-[#262a31] border border-[#3a4a3f]/30 rounded-lg text-[11px] font-semibold text-[#849588] hover:text-[#dfe2eb] hover:border-[#849588]/50 transition-all">
      <span class="material-symbols-outlined text-sm">share</span>Share
    </button>
  </div>
</header>

<!-- Carousel -->
<main class="flex-1 overflow-hidden relative">
  <div class="flex h-full transition-transform duration-500 ease-[cubic-bezier(.25,.8,.25,1)]" id="track">

    <!-- PAGE 1: Diagnostic Overview -->
    <div class="w-full h-full shrink-0 flex gap-6 px-6 py-5">
      <!-- Left: Mascot -->
      <section class="w-[35%] shrink-0">
        <div class="obsidian-layer h-full rounded-xl p-6 flex flex-col items-center justify-center gap-4">
          <div class="w-[200px]" style="filter:drop-shadow(0 12px 30px ${tier.color}40);image-rendering:pixelated;overflow:visible">${lobsterSvg}</div>
          <div class="w-full text-center space-y-3">
            <div class="flex flex-col items-center">
              <span class="text-6xl font-headline font-bold tracking-tighter" style="color:${tier.color}" id="scoreNum">0<span class="text-xl text-[#849588] opacity-40 ml-1">/ 100</span></span>
              <div class="w-40 h-1 bg-[#262a31] rounded-full mt-3 overflow-hidden">
                <div class="h-full rounded-full transition-all duration-1000" id="scoreBar" style="background:${tier.color};width:0%;box-shadow:0 0 12px ${tier.color}"></div>
              </div>
            </div>
            <div class="inline-flex items-center px-4 py-1 rounded-full border" style="background:${tier.color}10;border-color:${tier.color}30">
              <span class="text-[11px] font-headline font-bold tracking-[0.15em]" style="color:${tier.color}">TIER ${tier.grade} — ${tier.label}</span>
            </div>
            <p class="text-[#b9cbbd] text-sm italic leading-relaxed px-2">"${tier.quote}"</p>
          </div>
        </div>
      </section>

      <!-- Right: Dimensions -->
      <section class="w-[65%] flex flex-col">
        <div class="obsidian-layer h-full rounded-xl p-6 flex flex-col">
          <div class="flex justify-between items-end mb-5">
            <div>
              <p class="text-[10px] font-label uppercase tracking-[0.2em] text-[#849588] mb-0.5">Diagnostic Metrics</p>
              <h1 class="text-2xl font-headline font-bold text-[#f5fff5] tracking-tight">SECURITY DIMENSIONS</h1>
            </div>
            <span class="text-[10px] font-label font-mono" style="color:${tier.color}">STATUS: ${healthLabel}</span>
          </div>
          <div class="grid grid-cols-1 gap-2.5 flex-1 content-start">
            ${dimRowsHtml}
          </div>
          <div class="mt-auto pt-5 grid grid-cols-3 gap-3">
            <div class="bg-[#10141a] p-3 rounded-lg flex flex-col items-center border border-[#3a4a3f]/5">
              <span class="text-xl font-headline font-bold text-[#f5fff5]">${skills_scanned}</span>
              <span class="text-[9px] uppercase tracking-widest text-[#849588]">Skills</span>
            </div>
            <div class="bg-[#10141a] p-3 rounded-lg flex flex-col items-center border border-[#3a4a3f]/5">
              <span class="text-xl font-headline font-bold text-[#ffb4ab]">${totalFindings}</span>
              <span class="text-[9px] uppercase tracking-widest text-[#849588]">Findings</span>
            </div>
            <div class="p-3 rounded-lg flex flex-col items-center border" style="background:${tier.color}08;border-color:${tier.color}15">
              <span class="text-xl font-headline font-black" style="color:${tier.color}">${tier.grade}</span>
              <span class="text-[9px] uppercase tracking-widest" style="color:${tier.color}">Tier</span>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- PAGES 2+: Findings (paginated) -->
    ${findingsPages.map(content => `
    <div class="w-full h-full shrink-0 px-6 py-5 overflow-hidden">
      <div class="h-full rounded-xl p-6 flex flex-col overflow-y-auto border border-[#3a4a3f]/10 relative" style="background:linear-gradient(145deg,#1c2026 0%,#1a1518 100%)">
        <div class="absolute top-0 right-0 w-48 h-48 rounded-full blur-[100px] opacity-[0.03] pointer-events-none" style="background:#ffb4ab"></div>
        ${content}
      </div>
    </div>`).join('')}

    <!-- LAST PAGE: Security Analysis & Remediation -->
    <div class="w-full h-full shrink-0 px-6 py-5 overflow-hidden">
      <div class="h-full rounded-xl p-6 flex flex-col overflow-y-auto border border-[#3a4a3f]/10 relative" style="background:linear-gradient(145deg,#1c2026 0%,#151d20 100%)">
        <div class="absolute top-0 left-0 w-48 h-48 rounded-full blur-[100px] opacity-[0.04] pointer-events-none" style="background:${tier.color}"></div>
        <div class="flex justify-between items-start mb-5">
          <div>
            <p class="text-[10px] font-label uppercase tracking-[0.2em] text-[#849588] mb-1">Security Analysis</p>
            <h1 class="text-2xl font-headline font-bold text-[#f5fff5] tracking-tight flex items-center gap-3">
              <span class="material-symbols-outlined" style="color:${tier.color}">analytics</span>Diagnostic Report
            </h1>
          </div>
          <div class="bg-[#262a31] border border-[#3a4a3f]/15 rounded-lg px-4 py-2 flex items-center gap-2">
            <span class="material-symbols-outlined text-lg" style="color:${tier.color}">monitor_heart</span>
            <div><p class="text-[8px] text-[#849588] uppercase tracking-wider">System Health</p><p class="text-xs font-headline font-bold" style="color:${tier.color}">${healthLabel}</p></div>
          </div>
        </div>
        ${analysisHtml}
        <div class="mt-5 mb-3"><p class="text-[10px] font-label uppercase tracking-[0.2em] text-[#849588]">Action Items</p></div>
        ${recsHtml}
        <div class="mt-auto pt-4">
          <div class="relative rounded-xl p-5 flex items-center gap-5 border-2 overflow-hidden" style="background:linear-gradient(135deg,#1c2026,#12171e);border-color:${tier.color}30">
            <div class="absolute inset-0 opacity-5 pointer-events-none" style="background:linear-gradient(135deg,${tier.color},transparent)"></div>
            <span class="text-4xl relative z-10">🦞</span>
            <div class="flex-1 relative z-10">
              <p class="font-headline font-bold text-lg text-[#f5fff5] mb-1">24/7 Agent Protection</p>
              <p class="text-sm text-[#849588]">Automated skill scanning, threat intelligence feeds & team security dashboard.</p>
            </div>
            <a href="${ctaUrl}" target="_blank" class="relative z-10 px-6 py-2.5 rounded-lg font-bold text-sm text-[#0a0e14] uppercase tracking-wider no-underline hover:opacity-90 transition-opacity" style="background:${tier.color}">Upgrade to Premium</a>
          </div>
        </div>
      </div>
    </div>

  </div>
</main>

<!-- Bottom Nav -->
<nav class="shrink-0 flex items-center px-6 py-3 bg-[#1c2026]/90 backdrop-blur-md border-t border-[#3a4a3f]/15">
  <button id="prev" class="flex flex-col items-center text-[#849588] opacity-40 hover:opacity-100 hover:text-[#00ffa3] transition-all w-16">
    <span class="material-symbols-outlined">arrow_back</span>
    <span class="text-[9px] uppercase tracking-widest mt-0.5">Back</span>
  </button>

  <div class="flex-1 flex flex-col items-center gap-1">
    <div class="flex items-center gap-1.5" id="dots"></div>
    <div class="flex items-center gap-1 mt-1" id="steps">
      <button class="step active flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all" data-p="0">
        <span class="material-symbols-outlined text-sm">find_in_page</span>Overview
      </button>
      <span class="text-[#3a4a3f] text-xs">›</span>
      <button class="step flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all" data-p="1">
        <span class="material-symbols-outlined text-sm">bug_report</span>Analysis
      </button>
      <span class="text-[#3a4a3f] text-xs">›</span>
      <button class="step flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all" data-p="${totalPages - 1}">
        <span class="material-symbols-outlined text-sm">analytics</span>Report
      </button>
    </div>
  </div>

  <button id="next" class="flex flex-col items-center text-[#849588] opacity-40 hover:opacity-100 hover:text-[#00ffa3] transition-all w-16">
    <span class="material-symbols-outlined">arrow_forward</span>
    <span class="text-[9px] uppercase tracking-widest mt-0.5">Next</span>
  </button>
</nav>

<script>
(function(){
  const track=document.getElementById('track');
  const steps=[...document.querySelectorAll('.step')];
  const dotsEl=document.getElementById('dots');
  const prevBtn=document.getElementById('prev');
  const nextBtn=document.getElementById('next');
  const total=${totalPages};
  const tierColor='${tier.color}';
  let idx=0;

  // Create dots
  for(let i=0;i<total;i++){
    const d=document.createElement('div');
    d.className='rounded-full transition-all duration-300';
    d.style.height='6px';
    d.style.width=i===0?'20px':'6px';
    d.style.background=i===0?tierColor:'#3a4a3f';
    dotsEl.appendChild(d);
  }
  const dots=[...dotsEl.children];

  function go(i){
    idx=Math.max(0,Math.min(total-1,i));
    track.style.transform='translateX(-'+(idx*100)+'%)';
    dots.forEach((d,j)=>{d.style.width=j===idx?'20px':'6px';d.style.background=j===idx?tierColor:'#3a4a3f'});
    prevBtn.style.opacity=idx===0?'0.25':'1';
    nextBtn.style.opacity=idx===total-1?'0.25':'1';
    // Step highlights
    steps.forEach(s=>s.classList.remove('active'));
    if(idx===0)steps[0].classList.add('active');
    else if(idx===total-1)steps[2].classList.add('active');
    else steps[1].classList.add('active');
  }

  prevBtn.onclick=()=>go(idx-1);
  nextBtn.onclick=()=>go(idx+1);
  steps.forEach(s=>s.addEventListener('click',()=>go(+s.dataset.p)));
  // Also make dots clickable
  setTimeout(()=>{dots.forEach((d,i)=>d.style.cursor='pointer');dots.forEach((d,i)=>d.addEventListener('click',()=>go(i)));},100);
  document.addEventListener('keydown',e=>{if(e.key==='ArrowRight')go(idx+1);if(e.key==='ArrowLeft')go(idx-1)});
  let sx=0;
  track.addEventListener('touchstart',e=>{sx=e.touches[0].clientX},{passive:true});
  track.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-sx;if(Math.abs(dx)>40)go(idx+(dx<0?1:-1))},{passive:true});

  // Style active/inactive steps
  const style=document.createElement('style');
  style.textContent='.step{color:#849588}.step.active{color:${tier.color};background:${tier.color}15}';
  document.head.appendChild(style);

  // Dimension data for share card (must be before shareReport)
  const _dims=${JSON.stringify(Object.fromEntries(Object.entries(DIM_META).map(([k])=>[k,dimensions[k]||{score:null,na:false}])))};

  // ── Share Panel ──
  const shareText='🦞 我的 AI Agent 体检报告出炉！健康度 ${composite_score}/100，${tier.grade === 'S' ? '肌肉龙虾💪' : tier.grade === 'A' ? '健康龙虾🛡️' : tier.grade === 'B' ? '疲惫龙虾☕' : '病号龙虾🚨'}！快来测测你的小龙虾能得几分？\\n\\n@goplussecurity #AgentGuard\\nhttps://agentguard.gopluslabs.io';
  const shareUrl='https://agentguard.gopluslabs.io';

  function showToast(msg){
    const t=document.createElement('div');
    t.textContent=msg;
    t.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#262a31;color:#dfe2eb;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:9999;border:1px solid #3a4a3f;box-shadow:0 8px 24px #0008;transition:opacity .3s';
    document.body.appendChild(t);
    setTimeout(()=>{t.style.opacity='0';setTimeout(()=>t.remove(),300)},2500);
  }

  function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();}

  // Render share image with lobster SVG
  async function renderShareImage(){
    const W=1200,H=630;
    const c=document.createElement('canvas');c.width=W;c.height=H;
    const ctx=c.getContext('2d');

    // Background + card
    ctx.fillStyle='#0a0e14';ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#151c24';roundRect(ctx,40,40,W-80,H-80,16);ctx.fill();
    ctx.strokeStyle='#222d3a';ctx.lineWidth=1;roundRect(ctx,40,40,W-80,H-80,16);ctx.stroke();

    // Header
    ctx.fillStyle='#849588';ctx.font='600 12px Inter,sans-serif';ctx.fillText('AGENTGUARD DIAGNOSTIC REPORT',80,85);

    // Draw lobster SVG as image
    try{
      const svgEl=document.querySelector('.obsidian-layer svg');
      if(svgEl){
        const svgData=new XMLSerializer().serializeToString(svgEl);
        const img=new Image();
        await new Promise((res,rej)=>{
          img.onload=res;img.onerror=rej;
          img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svgData);
        });
        ctx.imageSmoothingEnabled=false; // keep pixel art crisp
        ctx.drawImage(img,120,110,200,200);
      }
    }catch(e){}

    // Score
    ctx.fillStyle='${tier.color}';ctx.font='900 80px "Space Grotesk",sans-serif';
    const scoreStr='${composite_score}';
    ctx.fillText(scoreStr,100,420);
    const scoreW=ctx.measureText(scoreStr).width;
    ctx.fillStyle='#4b5c6e';ctx.font='500 24px "Space Grotesk",sans-serif';ctx.fillText('/ 100',100+scoreW+12,420);

    // Tier badge
    ctx.fillStyle='${tier.color}';ctx.font='700 14px "Space Grotesk",sans-serif';
    ctx.fillText('TIER ${tier.grade} — ${tier.label}',100,460);

    // Quote
    ctx.fillStyle='#849588';ctx.font='italic 13px Inter,sans-serif';
    const q=document.querySelector('.obsidian-layer p[class*="italic"]');
    if(q)ctx.fillText(q.textContent,100,490);

    // Dimensions
    const dims=${JSON.stringify(Object.entries(DIM_META).map(([k,m])=>({key:k,name:m.name})))};
    let dy=100;
    ctx.font='600 11px Inter,sans-serif';ctx.fillStyle='#849588';ctx.fillText('SECURITY DIMENSIONS',620,dy);
    dy+=30;
    dims.forEach(d=>{
      const dim=_dims[d.key]||{score:null,na:false};
      const score=dim&&!dim.na?dim.score:null;
      const col=score===null?'#849588':score>=90?'#00ffa3':score>=70?'#00a2fd':score>=50?'#f0a830':'#ffb4ab';
      ctx.fillStyle='#dfe2eb';ctx.font='600 16px "Space Grotesk",sans-serif';ctx.fillText(d.name,620,dy);
      ctx.fillStyle=col;ctx.font='700 16px "Space Grotesk",sans-serif';
      const sv=score!==null?String(score):'--';
      ctx.fillText(sv,1100-ctx.measureText(sv).width,dy);
      dy+=10;
      ctx.fillStyle='#222d3a';roundRect(ctx,620,dy,480,5,3);ctx.fill();
      if(score!==null){ctx.fillStyle=col;roundRect(ctx,620,dy,480*(score/100),5,3);ctx.fill();}
      dy+=40;
    });

    // Stats
    const stats=[{v:'${skills_scanned}',l:'SKILLS'},{v:'${totalFindings}',l:'FINDINGS'},{v:'${tier.grade}',l:'TIER'}];
    let sx=620;
    stats.forEach(s=>{
      ctx.fillStyle='#1c2026';roundRect(ctx,sx,H-115,140,55,8);ctx.fill();
      ctx.fillStyle='#dfe2eb';ctx.font='800 22px "Space Grotesk",sans-serif';
      const tw=ctx.measureText(s.v).width;ctx.fillText(s.v,sx+70-tw/2,H-83);
      ctx.fillStyle='#849588';ctx.font='600 9px Inter,sans-serif';
      const lw=ctx.measureText(s.l).width;ctx.fillText(s.l,sx+70-lw/2,H-69);
      sx+=155;
    });

    // Footer
    ctx.fillStyle='#849588';ctx.font='500 11px Inter,sans-serif';ctx.fillText('Powered by GoPlus Security',80,H-70);
    ctx.fillStyle='#3a4a3f';ctx.fillText('agentguard.gopluslabs.io',80,H-55);

    return new Promise(res=>c.toBlob(res,'image/png'));
  }

  // Show share panel popup
  window.shareReport=async function(){
    // Remove existing panel if any
    document.getElementById('sharePanel')?.remove();

    const panel=document.createElement('div');
    panel.id='sharePanel';
    panel.innerHTML=\`
      <div style="position:fixed;inset:0;background:#0008;z-index:9998;display:flex;align-items:center;justify-content:center" onclick="if(event.target===this)this.parentElement.remove()">
        <div style="background:#1c2026;border:1px solid #3a4a3f;border-radius:16px;padding:24px;width:380px;max-width:90vw;box-shadow:0 24px 48px #000a">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <span style="font-family:Space Grotesk;font-weight:700;font-size:16px;color:#f5fff5">Share Report</span>
            <button onclick="document.getElementById('sharePanel').remove()" style="background:none;border:none;color:#849588;cursor:pointer;font-size:20px">&times;</button>
          </div>
          <div id="sharePreview" style="background:#0a0e14;border-radius:8px;height:120px;display:flex;align-items:center;justify-content:center;margin-bottom:16px;overflow:hidden">
            <span style="color:#849588;font-size:12px">Generating preview...</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">
            <button class="share-btn" data-platform="x" style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:12px 8px;background:#262a31;border:1px solid #3a4a3f30;border-radius:10px;color:#dfe2eb;cursor:pointer;font-size:10px;font-weight:600">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#dfe2eb"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              X
            </button>
            <button class="share-btn" data-platform="telegram" style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:12px 8px;background:#262a31;border:1px solid #3a4a3f30;border-radius:10px;color:#dfe2eb;cursor:pointer;font-size:10px;font-weight:600">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#29B6F6"><path d="M20.665 3.717l-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701h-.002l.002.001-.314 4.692c.46 0 .663-.211.921-.46l2.211-2.15 4.599 3.397c.848.467 1.457.227 1.668-.787L21.93 5.104c.31-1.24-.473-1.803-1.265-1.387z"/></svg>
              Telegram
            </button>
            <button class="share-btn" data-platform="whatsapp" style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:12px 8px;background:#262a31;border:1px solid #3a4a3f30;border-radius:10px;color:#dfe2eb;cursor:pointer;font-size:10px;font-weight:600">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              WhatsApp
            </button>
            <button class="share-btn" data-platform="download" style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:12px 8px;background:#262a31;border:1px solid #3a4a3f30;border-radius:10px;color:#dfe2eb;cursor:pointer;font-size:10px;font-weight:600">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#dfe2eb"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
              Download
            </button>
          </div>
          <button id="shareCopyBtn" style="width:100%;padding:10px;background:#262a31;border:1px solid #3a4a3f30;border-radius:8px;color:#849588;cursor:pointer;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#849588"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
            Copy image to clipboard
          </button>
        </div>
      </div>
    \`;
    document.body.appendChild(panel);

    // Generate image
    const blob=await renderShareImage();
    const imgUrl=URL.createObjectURL(blob);

    // Show preview
    const preview=document.getElementById('sharePreview');
    preview.innerHTML='<img src="'+imgUrl+'" style="width:100%;height:100%;object-fit:cover;border-radius:8px"/>';

    // Bind share buttons
    panel.querySelectorAll('.share-btn').forEach(btn=>{
      btn.onmouseenter=()=>{btn.style.background='#3a4a3f'};
      btn.onmouseleave=()=>{btn.style.background='#262a31'};
      btn.onclick=async()=>{
        const p=btn.dataset.platform;
        const text=encodeURIComponent(shareText);
        const url=encodeURIComponent(shareUrl);
        if(p==='x')window.open('https://x.com/intent/tweet?text='+text+'&url='+url,'_blank');
        else if(p==='telegram')window.open('https://t.me/share/url?url='+url+'&text='+text,'_blank');
        else if(p==='whatsapp')window.open('https://wa.me/?text='+text+'%20'+url,'_blank');
        else if(p==='download'){
          const a=document.createElement('a');a.href=imgUrl;a.download='agentguard-report.png';a.click();
          showToast('Image downloaded!');
        }
      };
    });

    // Copy to clipboard
    document.getElementById('shareCopyBtn').onclick=async()=>{
      try{
        await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
        document.getElementById('shareCopyBtn').innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="#00ffa3"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> Copied!';
        document.getElementById('shareCopyBtn').style.color='#00ffa3';
      }catch(e){showToast('Could not copy — try Download instead');}
    };
  };

  // Copy report
  window.copyReport=function(){
    const el=document.getElementById('analysisText');
    const btn=document.getElementById('copyBtn');
    const icon=document.getElementById('copyIcon');
    const label=document.getElementById('copyLabel');
    navigator.clipboard.writeText(el.innerText).then(()=>{
      icon.textContent='check';label.textContent='Copied!';
      btn.classList.add('!text-[#00ffa3]','!border-[#00ffa3]/30');
      setTimeout(()=>{icon.textContent='content_copy';label.textContent='Copy Report';btn.classList.remove('!text-[#00ffa3]','!border-[#00ffa3]/30')},2000);
    });
  };

  // Score animation
  const target=${composite_score};
  const el=document.getElementById('scoreNum');
  const bar=document.getElementById('scoreBar');
  const dur=1400,t0=performance.now();
  function tick(now){
    const p=Math.min((now-t0)/dur,1);
    const ease=1-Math.pow(1-p,3);
    const v=Math.round(target*ease);
    el.innerHTML=v+'<span class="text-xl text-[#849588] opacity-40 ml-1">/ 100</span>';
    bar.style.width=v+'%';
    if(p<1)requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
<\/script>
</body></html>`;

  const outPath = join(tmpdir(), `agentguard-checkup-${Date.now()}.html`);
  writeFileSync(outPath, html, 'utf8');
  console.log(outPath);

  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${outPath}"`, (err) => {
    if (err) process.stderr.write(`Could not open browser: ${err.message}\n`);
  });
  setTimeout(() => process.exit(0), 2000);
}
