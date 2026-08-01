interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// API mínima del Web Speech Recognition
interface SpeechRecognitionAlternativeLike {
  readonly transcript: string;
}
interface SpeechRecognitionResultLike {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionEventLike extends Event {
  readonly results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: ((this: SpeechRecognitionLike, ev: Event) => unknown) | null;
  onend: ((this: SpeechRecognitionLike, ev: Event) => unknown) | null;
  onresult: ((this: SpeechRecognitionLike, ev: SpeechRecognitionEventLike) => unknown) | null;
  onerror: ((this: SpeechRecognitionLike, ev: SpeechRecognitionErrorEventLike) => unknown) | null;
  start(): void;
  stop(): void;
}

const chatHistory: ChatMessage[] = [];
let currentUtterance: SpeechSynthesisUtterance | null = null;
let globalListenersBound = false;
let chatRequestController: AbortController | null = null;
let aiLifecycleVersion = 0;
let activeRecognition: SpeechRecognitionLike | null = null;
let placeholderTimer: ReturnType<typeof setTimeout> | null = null;
let startErrorTimer: ReturnType<typeof setTimeout> | null = null;
let focusTimer: ReturnType<typeof setTimeout> | null = null;

const clearPlaceholderTimer = () => {
  if (placeholderTimer !== null) {
    clearTimeout(placeholderTimer);
    placeholderTimer = null;
  }
  if (startErrorTimer !== null) {
    clearTimeout(startErrorTimer);
    startErrorTimer = null;
  }
};

function cleanupAiAgent() {
  aiLifecycleVersion += 1;
  clearPlaceholderTimer();
  if (focusTimer !== null) {
    clearTimeout(focusTimer);
    focusTimer = null;
  }
  chatRequestController?.abort();
  chatRequestController = null;
  stopSpeaking();
  if (activeRecognition) {
    activeRecognition.onstart = null;
    activeRecognition.onend = null;
    activeRecognition.onresult = null;
    activeRecognition.onerror = null;
    try { activeRecognition.stop(); } catch {}
    activeRecognition = null;
  }
}


function scrollToBottom() {
  const messagesContainer = document.getElementById('ai-agent-messages');
  if (messagesContainer) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function stopSpeaking() {
  if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }
  document.querySelectorAll('.ai-speak-btn .material-symbols-outlined').forEach(icon => {
    icon.textContent = 'volume_up';
  });
}

function speakText(text: string, button: HTMLButtonElement) {
  if ('speechSynthesis' in window) {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      if (currentUtterance && currentUtterance.text === text) {
        button.querySelector('.material-symbols-outlined')!.textContent = 'volume_up';
        return;
      }
    }

    document.querySelectorAll('.ai-speak-btn .material-symbols-outlined').forEach(icon => {
      icon.textContent = 'volume_up';
    });

    const cleanText = text.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'es-MX';

    utterance.onstart = () => {
      button.querySelector('.material-symbols-outlined')!.textContent = 'volume_off';
    };

    utterance.onend = () => {
      button.querySelector('.material-symbols-outlined')!.textContent = 'volume_up';
    };

    utterance.onerror = () => {
      button.querySelector('.material-symbols-outlined')!.textContent = 'volume_up';
    };

    currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  } else {
    alert('Tu navegador no soporta síntesis de voz.');
  }
}

function appendUserMessage(text: string) {
  const messagesContainer = document.getElementById('ai-agent-messages');
  if (!messagesContainer) return;
  const msgHtml = `
    <div class="flex justify-end w-full">
      <div class="max-w-[80%] break-words rounded-2xl rounded-tr-md bg-accent-600 px-3.5 py-2 text-[13px] leading-relaxed text-white shadow-sm shadow-accent-600/25">
        ${escapeHtml(text)}
      </div>
    </div>
  `;
  messagesContainer.insertAdjacentHTML('beforeend', msgHtml);
  scrollToBottom();
}

function appendAssistantLoader(): string {
  const messagesContainer = document.getElementById('ai-agent-messages');
  if (!messagesContainer) return '';
  const id = 'loader-' + Date.now();
  const msgHtml = `
    <div id="${id}" class="flex items-start gap-2 max-w-[85%]">
      <span class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200/70 bg-white/70 text-slate-500 backdrop-blur-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
        <span class="material-symbols-outlined text-[14px]" style="font-variation-settings:'FILL' 1">auto_awesome</span>
      </span>
      <div class="ai-bubble-content flex items-center min-h-[32px] rounded-2xl rounded-tl-md border border-slate-200/60 bg-white/70 px-3.5 py-2 text-[13px] leading-relaxed text-slate-800 backdrop-blur-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-100">
        <div class="loader-wrapper !h-6 !scale-75 origin-left">
          <span class="loader-letter" style="--i: 0">P</span>
          <span class="loader-letter" style="--i: 1">e</span>
          <span class="loader-letter" style="--i: 2">n</span>
          <span class="loader-letter" style="--i: 3">s</span>
          <span class="loader-letter" style="--i: 4">a</span>
          <span class="loader-letter" style="--i: 5">n</span>
          <span class="loader-letter" style="--i: 6">d</span>
          <span class="loader-letter" style="--i: 7">o</span>
          <span class="loader-letter" style="--i: 8">.</span>
          <span class="loader-letter" style="--i: 9">.</span>
          <div class="loader !w-6 !h-6"></div>
        </div>
      </div>
    </div>
  `;
  messagesContainer.insertAdjacentHTML('beforeend', msgHtml);
  scrollToBottom();
  return id;
}

function updateAssistantMessage(id: string, text: string, route: string[] = [], action: string = 'chat') {
  const el = document.getElementById(id);
  if (!el) return;

  const formattedText = escapeHtml(text).replace(/\n/g, '<br/>');

  let actionsHtml = '';
  if (route && route.length > 0) {
    const isMapPage = window.location.pathname.startsWith('/mapa');
    const routeStr = route.join(',');

    actionsHtml += '<div class="flex flex-wrap gap-2 mt-3">';

    if (action === 'reserve' && route.length === 1) {
      actionsHtml += `
        <button
          class="ai-reserve-trigger flex items-center justify-center gap-1.5 rounded-xl bg-accent-600 hover:bg-accent-500 text-white font-semibold px-3 py-1.5 text-[11px] shadow-sm shadow-accent-600/25 transition-all active:scale-[0.97]"
          data-monument="${route[0]}"
        >
          <span class="material-symbols-outlined text-[14px]">calendar_month</span>
          Reservar Recorrido
        </button>
      `;
    } else if (isMapPage) {
      actionsHtml += `
        <button
          class="ai-route-trigger flex items-center justify-center gap-1.5 rounded-xl bg-accent-600 hover:bg-accent-500 text-white font-semibold px-3 py-1.5 text-[11px] shadow-sm shadow-accent-600/25 transition-all active:scale-[0.97]"
          data-route="${routeStr}"
        >
          <span class="material-symbols-outlined text-[14px]">map</span>
          Trazar ruta
        </button>
      `;

      if (route.length === 1) {
        actionsHtml += `
          <button
            class="ai-audio-trigger flex items-center justify-center gap-1.5 rounded-xl border border-slate-300/60 bg-transparent hover:border-accent-500/40 hover:text-accent-600 text-slate-600 dark:border-white/15 dark:text-slate-300 dark:hover:border-accent-400/40 dark:hover:text-accent-400 font-semibold px-3 py-1.5 text-[11px] transition-all active:scale-[0.97]"
            data-monument="${route[0]}"
          >
            <span class="material-symbols-outlined text-[14px]">headphones</span>
            Escuchar audioguía
          </button>
        `;
      }
    } else {
      actionsHtml += `
        <a
          href="/mapa?route=${routeStr}"
          class="inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent-600 hover:bg-accent-500 text-white font-semibold px-3 py-1.5 text-[11px] shadow-sm shadow-accent-600/25 transition-all active:scale-[0.97]"
        >
          <span class="material-symbols-outlined text-[14px]">explore</span>
          Ver ruta en el mapa
        </a>
      `;

      if (route.length === 1) {
        actionsHtml += `
          <a
            href="/mapa?route=${route[0]}&play=true"
            class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300/60 bg-transparent hover:border-accent-500/40 hover:text-accent-600 text-slate-600 dark:border-white/15 dark:text-slate-300 dark:hover:border-accent-400/40 dark:hover:text-accent-400 font-semibold px-3 py-1.5 text-[11px] transition-all active:scale-[0.97]"
          >
            <span class="material-symbols-outlined text-[14px]">headphones</span>
            Escuchar audioguía
          </a>
        `;
      }
    }

    actionsHtml += '</div>';
  }

  const bubbleEl = el.querySelector('.ai-bubble-content');
  if (bubbleEl) {
    bubbleEl.classList.remove('flex', 'items-center', 'min-h-[32px]');
    bubbleEl.classList.add('block', 'break-words', 'relative', 'pr-8');
    bubbleEl.innerHTML = `
      <div class="pr-2">
        ${formattedText}
      </div>
      <button
        class="ai-speak-btn absolute top-2 right-2 p-0.5 text-slate-400 transition-colors hover:text-accent-600 dark:text-slate-500 dark:hover:text-accent-400"
        title="Escuchar respuesta"
      >
        <span class="material-symbols-outlined text-[16px]">volume_up</span>
      </button>
      ${actionsHtml}
    `;
  }

  const speakBtn = el.querySelector('.ai-speak-btn') as HTMLButtonElement;
  if (speakBtn) {
    speakBtn.addEventListener('click', () => {
      speakText(text, speakBtn);
    });
  }

  if (route && route.length > 0) {
    if (action === 'reserve') {
      const reserveBtn = el.querySelector('.ai-reserve-trigger');
      reserveBtn?.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('ai-reserve-tour', { detail: { monumentId: route[0] } }));
        const aiPopover = document.getElementById('ai-agent-popover');
        if (aiPopover) {
          aiPopover.classList.add('hidden');
          stopSpeaking();
        }
      });
    } else if (window.location.pathname.startsWith('/mapa')) {
      const routeBtn = el.querySelector('.ai-route-trigger');
      routeBtn?.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('ai-route-generated', { detail: { route } }));
      });

      const audioBtn = el.querySelector('.ai-audio-trigger');
      audioBtn?.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('ai-play-audio', { detail: { monumentId: route[0] } }));
      });
    }
  }

  scrollToBottom();
}

let lastInitializedLifecycle = -1;

function initAiAgent() {
  if (lastInitializedLifecycle === aiLifecycleVersion) return;
  lastInitializedLifecycle = aiLifecycleVersion;

  const lifecycleVersion = aiLifecycleVersion;
  const aiBtn = document.getElementById('ai-agent-btn');
  const aiPopover = document.getElementById('ai-agent-popover');
  const aiClose = document.getElementById('ai-agent-close');
  const aiForm = document.getElementById('ai-agent-form') as HTMLFormElement;
  const aiInput = document.getElementById('ai-agent-input') as HTMLInputElement;
  const searchbarBtns = document.querySelectorAll('#ai-agent-btn-searchbar');
  const aiContainer = document.getElementById('ai-agent-container');
  const micBtn = document.getElementById('ai-mic-btn') as HTMLButtonElement;

  function safeAddListener(
    el: HTMLElement | null,
    event: string,
    handler: EventListenerOrEventListenerObject
  ) {
    if (!el) return;
    const key = `aiBound_${event}`;
    if (el.dataset[key] === 'true') return;
    el.dataset[key] = 'true';
    el.addEventListener(event, handler);
  }

  if (!aiPopover) return;

  if (aiBtn) {
    aiBtn.classList.remove('hidden');
  }

  function resetPosition() {
    if (!aiContainer || !aiPopover) return;
    aiContainer.style.zIndex = '90';
    aiPopover.style.zIndex = '99';
  }

  resetPosition();

  const togglePopover = (e: Event) => {
    e.stopPropagation();
    aiPopover.classList.toggle('hidden');
    if (!aiPopover.classList.contains('hidden')) {
      if (focusTimer !== null) clearTimeout(focusTimer);
      focusTimer = setTimeout(() => {
        focusTimer = null;
        if (lifecycleVersion === aiLifecycleVersion) aiInput?.focus();
      }, 100);
      scrollToBottom();
    }
  };

  if (aiBtn) {
    safeAddListener(aiBtn, 'click', togglePopover);
  }

  searchbarBtns.forEach((btn) => {
    if (btn instanceof HTMLElement) {
      safeAddListener(btn, 'click', togglePopover);
    }
  });

  if (aiClose) {
    safeAddListener(aiClose, 'click', (e) => {
      e.stopPropagation();
      aiPopover.classList.add('hidden');
      stopSpeaking();
    });
  }

  const welcomeSpeakBtn = document.querySelector('#ai-agent-messages .ai-speak-btn') as HTMLButtonElement;
  if (welcomeSpeakBtn) {
    const welcomeText = '¡Hola! Soy tu asistente de TuriMap. ¿Quieres que te recomiende una ruta de monumentos o te cuente la historia de algún lugar de la CDMX? ¡Pregúntame lo que quieras!';
    safeAddListener(welcomeSpeakBtn, 'click', () => {
      speakText(welcomeText, welcomeSpeakBtn);
    });
  }

  if (aiForm) {
    safeAddListener(aiForm, 'submit', async (e) => {
      e.preventDefault();
      if (!aiInput) return;
      const text = aiInput.value.trim();
      if (!text) return;

    aiInput.value = '';
    appendUserMessage(text);
    chatHistory.push({ role: 'user', content: text });

    const loaderId = appendAssistantLoader();

    const userLat = localStorage.getItem('turimap_user_lat');
    const userLng = localStorage.getItem('turimap_user_lng');
    const userLocation = userLat && userLng ? {
      lat: parseFloat(userLat),
      lng: parseFloat(userLng)
    } : null;

    const controller = new AbortController();
    chatRequestController?.abort();
    chatRequestController = controller;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: chatHistory,
          userLocation: userLocation
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error('Response error');
      }

      const data = await response.json();
      if (lifecycleVersion !== aiLifecycleVersion || controller.signal.aborted) return;
      const botReply = data.reply || 'Disculpa, se me complicó procesar la respuesta en este momento.';
      const botRoute = data.route || [];
      const botAction = data.action || 'chat';

      chatHistory.push({ role: 'assistant', content: botReply });
      updateAssistantMessage(loaderId, botReply, botRoute, botAction);

      if (botAction === 'route' && botRoute.length > 0 && window.location.pathname.startsWith('/mapa')) {
        window.dispatchEvent(new CustomEvent('ai-route-generated', { detail: { route: botRoute } }));
      }

    } catch (err) {
      if (controller.signal.aborted || lifecycleVersion !== aiLifecycleVersion) return;
      console.error(err);
      updateAssistantMessage(loaderId, '¡Hola! Perdón, pero se perdió la conexión con el servidor. ¿Podrías intentar de nuevo en un momento?');
    } finally {
      if (chatRequestController === controller) chatRequestController = null;
    }
  });
}

  let recognition: SpeechRecognitionLike | null = null;
  let isListening = false;

  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognitionCtor = (window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    }).SpeechRecognition ?? (window as unknown as {
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    }).webkitSpeechRecognition;

    if (SpeechRecognitionCtor) {
      recognition = new SpeechRecognitionCtor();
      activeRecognition = recognition;
      recognition.continuous = false;
      recognition.interimResults = false;
      const userLang = navigator.language || 'es-MX';
      recognition.lang = ['es-MX', 'es-ES', 'es-AR', 'es'].includes(userLang) ? userLang : 'es-MX';
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        if (lifecycleVersion !== aiLifecycleVersion) return;
        isListening = true;
        if (micBtn) {
          micBtn.classList.remove('bg-slate-50', 'text-slate-500', 'dark:bg-slate-800');
          micBtn.classList.add('bg-red-500', 'text-white', 'animate-pulse');
          const icon = micBtn.querySelector('.material-symbols-outlined');
          if (icon) icon.textContent = 'mic_off';
        }
        if (aiInput) {
          aiInput.placeholder = 'Escuchando...';
        }
      };

      recognition.onend = () => {
        if (lifecycleVersion !== aiLifecycleVersion) return;
        isListening = false;
        if (micBtn) {
          micBtn.classList.add('bg-slate-50', 'text-slate-500', 'dark:bg-slate-800');
          micBtn.classList.remove('bg-red-500', 'text-white', 'animate-pulse');
          const icon = micBtn.querySelector('.material-symbols-outlined');
          if (icon) icon.textContent = 'mic';
        }
        if (aiInput) {
          aiInput.placeholder = '¿Qué ruta querés hacer hoy?...';
        }
      };

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        if (lifecycleVersion !== aiLifecycleVersion) return;
        const transcript = event.results[0][0].transcript;
        if (aiInput && transcript && aiForm) {
          aiInput.value = transcript;
          aiForm.requestSubmit();
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
        if (lifecycleVersion !== aiLifecycleVersion) return;
        console.error('Speech recognition error', event.error);
        const messages: Record<string, string> = {
          'not-allowed': 'Permiso de micrófono denegado. Activalo en Configuración del navegador.',
          'no-speech': 'No detecté voz. Probá de nuevo.',
          'audio-capture': 'No encontré micrófono disponible.',
          'network': 'Error de red. Verificá tu conexión.',
          'service-not-allowed': 'Servicio de reconocimiento no disponible en este dispositivo.',
          'aborted': 'Reconocimiento cancelado.',
        };
        const msg = messages[event.error] || `Error: ${event.error || 'desconocido'}`;
        if (aiInput) {
          const originalPlaceholder = aiInput.placeholder;
          clearPlaceholderTimer();
          aiInput.placeholder = msg;
          placeholderTimer = setTimeout(() => {
            placeholderTimer = null;
            if (lifecycleVersion === aiLifecycleVersion && aiInput) aiInput.placeholder = originalPlaceholder;
          }, 4000);
        }
        if (recognition && isListening) {
          try { recognition.stop(); } catch {}
        }
      };

      if (micBtn) {
        safeAddListener(micBtn, 'click', (e) => {
          const ev = e as MouseEvent;
          ev.preventDefault();
          ev.stopPropagation();
          if (!recognition || lifecycleVersion !== aiLifecycleVersion) return;
          if (isListening) {
          try { recognition.stop(); } catch {}
        } else {
          try {
            recognition.start();
          } catch (err) {
            console.error('Failed to start recognition:', err);
            if (aiInput) {
              const original = aiInput.placeholder;
              clearPlaceholderTimer();
              aiInput.placeholder = 'No pude iniciar el micrófono. Reintentá.';
              startErrorTimer = setTimeout(() => {
                startErrorTimer = null;
                if (lifecycleVersion === aiLifecycleVersion && aiInput) aiInput.placeholder = original;
              }, 3000);
            }
          }
        }
      });
    }
  }
  } else {
    if (micBtn) {
      micBtn.style.display = 'none';
    }
  }
}

document.addEventListener('astro:page-load', () => {
  initAiAgent();
});

if (document.readyState === 'interactive' || document.readyState === 'complete') {
  initAiAgent();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    initAiAgent();
  });
}

document.addEventListener('astro:before-swap', cleanupAiAgent);
window.addEventListener('pagehide', cleanupAiAgent);
window.addEventListener('beforeunload', cleanupAiAgent);

// Registrar listeners globales una sola vez en window/document
if (typeof window !== 'undefined' && !globalListenersBound) {
  globalListenersBound = true;

  if ('visualViewport' in window) {
    const handleViewportResize = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      const aiContainer = document.getElementById('ai-agent-container');
      const aiPopover = document.getElementById('ai-agent-popover');
      const bottomNav = document.querySelector('nav.glassmorphism') as HTMLElement | null;
      if (!aiContainer || !aiPopover) return;

      const keyboardOpen = vv.height < window.innerHeight - 100;
      if (keyboardOpen && !aiPopover.classList.contains('hidden')) {
        const keyboardHeight = window.innerHeight - vv.height;
        aiContainer.style.top = 'auto';
        aiContainer.style.bottom = `${keyboardHeight + 16}px`;
        aiContainer.style.right = '12px';
        aiContainer.style.left = 'auto';
        aiContainer.style.transform = 'none';
        aiContainer.style.maxWidth = 'calc(100vw - 24px)';
        aiPopover.style.maxWidth = 'calc(100vw - 24px)';
        aiPopover.style.height = `${Math.max(220, vv.height - keyboardHeight - 16)}px`;
        if (bottomNav) bottomNav.style.transform = 'translateY(100%)';
      } else {
        if (window.location.pathname.startsWith('/mapa')) {
          aiContainer.classList.remove('bottom-[76px]', 'right-4', 'fixed');
          aiContainer.style.position = 'fixed';
          aiContainer.style.top = 'calc(env(safe-area-inset-top, 0px) + 74px)';
          aiContainer.style.left = '50%';
          aiContainer.style.transform = 'translateX(-50%)';
          aiContainer.style.width = '100%';
          aiContainer.style.maxWidth = '512px';
          aiContainer.style.paddingLeft = '16px';
          aiContainer.style.paddingRight = '16px';
          aiContainer.style.zIndex = '40';
          aiContainer.style.pointerEvents = 'none';
          aiContainer.style.bottom = '';
          aiContainer.style.right = '';

          aiPopover.classList.remove('bottom-16', 'mb-2', 'absolute', 'right-0');
          aiPopover.classList.add('relative', 'w-full', 'mt-2');
          aiPopover.style.pointerEvents = 'auto';
          aiPopover.style.height = '380px';
          aiPopover.style.maxHeight = 'calc(100vh - 150px)';
        } else {
          aiContainer.style.position = '';
          aiContainer.style.top = '';
          aiContainer.style.left = '';
          aiContainer.style.transform = '';
          aiContainer.style.width = '';
          aiContainer.style.maxWidth = '';
          aiContainer.style.paddingLeft = '';
          aiContainer.style.paddingRight = '';
          aiContainer.style.zIndex = '';
          aiContainer.style.pointerEvents = '';
          aiContainer.style.bottom = '';
          aiContainer.style.right = '';

          aiPopover.classList.add('bottom-16', 'mb-2', 'absolute', 'right-0');
          aiPopover.classList.remove('relative', 'w-full', 'mt-2');
          aiPopover.style.pointerEvents = '';
          aiPopover.style.height = '';
          aiPopover.style.maxHeight = '';
        }
        if (bottomNav) bottomNav.style.transform = '';
      }
    };

    window.visualViewport?.addEventListener('resize', handleViewportResize);
    window.visualViewport?.addEventListener('scroll', handleViewportResize);

    document.addEventListener('focusin', (e) => {
      const aiInput = document.getElementById('ai-agent-input');
      if (e.target === aiInput) {
        requestAnimationFrame(() => handleViewportResize());
        setTimeout(handleViewportResize, 250);
      }
    });
    document.addEventListener('focusout', (e) => {
      const aiInput = document.getElementById('ai-agent-input');
      if (e.target === aiInput) {
        setTimeout(handleViewportResize, 250);
      }
    });
  }

  document.addEventListener('click', (e) => {
    const aiPopover = document.getElementById('ai-agent-popover');
    const aiBtn = document.getElementById('ai-agent-btn');
    const searchbarBtns = document.querySelectorAll('#ai-agent-btn-searchbar');
    if (!aiPopover || aiPopover.classList.contains('hidden')) return;

    const target = e.target as Node;
    const clickedBtn = (aiBtn && aiBtn.contains(target)) ||
                       Array.from(searchbarBtns).some(btn => btn.contains(target));
    if (!aiPopover.contains(target) && !clickedBtn) {
      aiPopover.classList.add('hidden');
      stopSpeaking();
    }
  });

  window.addEventListener('ai-route-generated', () => {
    const aiPopover = document.getElementById('ai-agent-popover');
    if (aiPopover) {
      aiPopover.classList.add('hidden');
      stopSpeaking();
    }
  });
}
