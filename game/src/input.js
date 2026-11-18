// input.js — keyboard state (Set of codes), mouse-look deltas,
// Pointer Lock, edge-triggered justPressed(). No allocations per frame.
(function (VR) {
  'use strict';

  var keys = new Set();
  var pressedEdge = new Set(); // codes pressed since last frame consumption
  var mouseDX = 0;
  var mouseDY = 0;
  var locked = false;
  var lockElement = null;

  function onKeyDown(e) {
    if (!keys.has(e.code)) pressedEdge.add(e.code);
    keys.add(e.code);
    // Keep browser from scrolling / tabbing away during play.
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
  }

  function onKeyUp(e) {
    keys.delete(e.code);
  }

  function onMouseMove(e) {
    if (!locked) return;
    mouseDX += e.movementX || 0;
    mouseDY += e.movementY || 0;
  }

  function onLockChange() {
    locked = (document.pointerLockElement === lockElement);
  }

  function onBlur() {
    keys.clear();
    pressedEdge.clear();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerlockchange', onLockChange);

  VR.Input = {
    keys: keys,

    get pointerLocked() { return locked; },

    // Request pointer lock on the game canvas (call from a user gesture).
    requestLock: function (element) {
      lockElement = element || document.body;
      if (document.pointerLockElement !== lockElement) {
        try { lockElement.requestPointerLock(); } catch (err) { /* ignore */ }
      }
    },

    exitLock: function () {
      if (document.pointerLockElement) document.exitPointerLock();
    },

    // Edge-triggered: true only on the first frame the key went down.
    justPressed: function (code) {
      return pressedEdge.has(code);
    },

    // Consume this frame's mouse deltas (returns a reused object).
    consumeMouse: (function () {
      var out = { dx: 0, dy: 0 };
      return function () {
        out.dx = mouseDX;
        out.dy = mouseDY;
        mouseDX = 0;
        mouseDY = 0;
        return out;
      };
    })(),

    // Called once per frame by main.js after all modules read input.
    endFrame: function () {
      pressedEdge.clear();
    }
  };

})(window.VR = window.VR || {});
