interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// API mínima del Web Speech Recognition (no está en lib.dom por defecto en
// todos los targets; acá solo usamos el subset necesario para dictado de voz).
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

const aiBtn = document.getElementById('ai-agent-btn');
const aiPopover = document.getElementById('ai-agent-popover');
const aiClose = document.getElementById('ai-agent-close');
const aiForm = document.getElementById('ai-agent-form') as HTMLFormElement;
const aiInput = document.getElementById('ai-agent-input') as HTMLInputElement;
const messagesContainer = document.getElementById('ai-agent-messages');

const chatHistory: ChatMessage[] = [];
let currentUtterance: SpeechSynthesisUtterance | null = null;

// Ajustar posición si estamos en la página del mapa para evitar superposición
const aiContainer = document.getElementById('ai-agent-container');
if (aiContainer && aiPopover && window.location.pathname.startsWith('/mapa')) {
  aiContainer.classList.remove('bottom-[76px]', 'right-4');
  aiContainer.classList.add('top-[135px]', 'right-3', 'sm:right-4');

  // Desplegar el popover hacia abajo
  aiPopover.classList.remove('bottom-16', 'mb-2', 'h-[420px]');
  aiPopover.classList.add('top-16', 'mt-2', 'h-[360px]');
}

// Ajustar posición del popover cuando aparece el teclado en iOS
const bottomNav = document.querySelector('nav.glassmorphism') as HTMLElement | null;
if (aiContainer && 'visualViewport' in window) {
  const handleViewportResize = () => {
    const vv = window.visualViewport;
    if (!vv) return;
    // Si el viewport visible es mucho menor que el de la ventana, el teclado está abierto
    const keyboardOpen = vv.height < window.innerHeight - 100;
    if (keyboardOpen && !aiPopover?.classList.contains('hidden')) {
      // Teclado abierto + popover abierto → posicionar arriba del teclado.
      // Forzar bottom inline; esto anula el `top-[135px]` del mapa.
      const keyboardHeight = window.innerHeight - vv.height;
      aiContainer.style.top = 'auto';
      aiContainer.style.bottom = `${keyboardHeight + 16}px`;
      aiContainer.style.right = '12px';
      // Limitar ancho en pantallas chicas para que no se salga
      aiContainer.style.maxWidth = 'calc(100vw - 24px)';
      if (aiPopover) {
        aiPopover.style.maxWidth = 'calc(100vw - 24px)';
        // Achicar el popover para que entre arriba del teclado
        aiPopover.style.height = `${Math.max(220, vv.height - keyboardHeight - 16)}px`;
      }
      // Esconder el bottom nav mientras el teclado esté abierto
      if (bottomNav) bottomNav.style.transform = 'translateY(100%)';
    } else {
      aiContainer.style.top = '';
      aiContainer.style.bottom = '';
      aiContainer.style.right = '';
      aiContainer.style.height = '';
      aiContainer.style.maxWidth = '';
      if (aiPopover) {
        aiPopover.style.maxWidth = '';
        aiPopover.style.height = '';
      }
      if (bottomNav) bottomNav.style.transform = '';
    }
  };
  window.visualViewport?.addEventListener('resize', handleViewportResize);
  window.visualViewport?.addEventListener('scroll', handleViewportResize);

  // Fallback: en iOS a veces resize se dispara tarde; usar focusin para re-evaluar
  document.addEventListener('focusin', (e) => {
    if (e.target === aiInput) {
      // Esperar un frame para que iOS termine de animar el teclado
      requestAnimationFrame(() => handleViewportResize());
      // Y otro por las dudas
      setTimeout(handleViewportResize, 250);
    }
  });
  document.addEventListener('focusout', (e) => {
    if (e.target === aiInput) {
      setTimeout(handleViewportResize, 250);
    }
  });
}

// Abrir y cerrar Popover
if (aiBtn && aiPopover) {
  aiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    aiPopover.classList.toggle('hidden');
    if (!aiPopover.classList.contains('hidden')) {
      setTimeout(() => aiInput?.focus(), 100);
      scrollToBottom();
    }
  });

  aiClose?.addEventListener('click', (e) => {
    e.stopPropagation();
    aiPopover.classList.add('hidden');
    stopSpeaking();
  });

  // Cerrar al hacer clic afuera
  document.addEventListener('click', (e) => {
    if (!aiPopover.contains(e.target as Node) && !aiBtn.contains(e.target as Node)) {
      aiPopover.classList.add('hidden');
      stopSpeaking();
    }
  });

  aiPopover.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // Cerrar el chatbot automáticamente cuando se traza una ruta en el mapa
  window.addEventListener('ai-route-generated', () => {
    aiPopover.classList.add('hidden');
    stopSpeaking();
  });
}

function scrollToBottom() {
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

    // Resetear todos los íconos de volumen en los botones
    document.querySelectorAll('.ai-speak-btn .material-symbols-outlined').forEach(icon => {
      icon.textContent = 'volume_up';
    });

    // Limpiar etiquetas HTML para la lectura por voz
    const cleanText = text.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ');

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'es-MX'; // Español de México / Latino

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
  if (!messagesContainer) return;
  const msgHtml = `
    <div class="flex justify-end w-full">
      <div class="bg-brand-500 text-white rounded-2xl rounded-tr-none px-3.5 py-2 text-[12px] max-w-[85%] shadow-sm leading-relaxed break-words">
        ${escapeHtml(text)}
      </div>
    </div>
  `;
  messagesContainer.insertAdjacentHTML('beforeend', msgHtml);
  scrollToBottom();
}

function appendAssistantLoader(): string {
  if (!messagesContainer) return '';
  const id = 'loader-' + Date.now();
  const msgHtml = `
    <div id="${id}" class="flex items-start gap-2 max-w-[85%]">
      <span class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 text-[12px]">
        <span class="material-symbols-outlined text-[14px]">smart_toy</span>
      </span>
      <div class="ai-bubble-content bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100 rounded-2xl rounded-tl-none px-3.5 py-2 text-[12px] shadow-sm leading-relaxed flex items-center min-h-[32px]">
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

function updateAssistantMessage(id: string, text: string, route: string[] = []) {
  const el = document.getElementById(id);
  if (!el) return;

  const formattedText = escapeHtml(text).replace(/\n/g, '<br/>');

  // Botones de acción si tiene ruta o monumentos
  let actionsHtml = '';
  if (route && route.length > 0) {
    const isMapPage = window.location.pathname.startsWith('/mapa');
    const routeStr = route.join(',');

    actionsHtml += '<div class="flex flex-wrap gap-2 mt-3">';

    if (isMapPage) {
      actionsHtml += `
        <button
          class="ai-route-trigger flex items-center justify-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold px-3 py-1.5 text-[11px] shadow-sm transition-all active:scale-[0.97]"
          data-route="${routeStr}"
        >
          <span class="material-symbols-outlined text-[14px]">map</span>
          Trazar ruta
        </button>
      `;

      // Si es exactamente un monumento, agregar la opción de reproducir audioguía
      if (route.length === 1) {
        actionsHtml += `
          <button
            class="ai-audio-trigger flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-3 py-1.5 text-[11px] shadow-sm transition-all active:scale-[0.97]"
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
          class="inline-flex items-center justify-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold px-3 py-1.5 text-[11px] shadow-sm transition-all active:scale-[0.97]"
        >
          <span class="material-symbols-outlined text-[14px]">explore</span>
          Ver ruta en el mapa
        </a>
      `;

      if (route.length === 1) {
        actionsHtml += `
          <a
            href="/mapa?route=${route[0]}&play=true"
            class="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-3 py-1.5 text-[11px] shadow-sm transition-all active:scale-[0.97]"
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
        class="ai-speak-btn absolute top-2 right-2 text-slate-400 hover:text-brand-600 transition-colors p-0.5"
        title="Escuchar respuesta"
      >
        <span class="material-symbols-outlined text-[16px]">volume_up</span>
      </button>
      ${actionsHtml}
    `;
  }

  // Agregar event listener para volumen (TTS)
  const speakBtn = el.querySelector('.ai-speak-btn') as HTMLButtonElement;
  if (speakBtn) {
    speakBtn.addEventListener('click', () => {
      speakText(text, speakBtn);
    });
  }

  // Agregar event listeners para acciones de mapa/audio
  if (route && route.length > 0 && window.location.pathname.startsWith('/mapa')) {
    const routeBtn = el.querySelector('.ai-route-trigger');
    routeBtn?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('ai-route-generated', { detail: { route } }));
    });

    const audioBtn = el.querySelector('.ai-audio-trigger');
    audioBtn?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('ai-play-audio', { detail: { monumentId: route[0] } }));
    });
  }

  scrollToBottom();
}

// Speech Recognition (Dictado de voz)
const micBtn = document.getElementById('ai-mic-btn') as HTMLButtonElement;
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
    recognition.continuous = false;
    recognition.interimResults = false;
    // Lang: usar el del navegador si es español, sino fallback a es-MX
    const userLang = navigator.language || 'es-MX';
    recognition.lang = ['es-MX', 'es-ES', 'es-AR', 'es'].includes(userLang) ? userLang : 'es-MX';
    recognition.maxAlternatives = 1;

  recognition.onstart = () => {
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
    const transcript = event.results[0][0].transcript;
    if (aiInput && transcript) {
      aiInput.value = transcript;
      aiForm.requestSubmit();
    }
  };

  recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
    console.error('Speech recognition error', event.error);
    // Feedback user-friendly según tipo de error
    const messages: Record<string, string> = {
      'not-allowed': 'Permiso de micrófono denegado. Activalo en Configuración del navegador.',
      'no-speech': 'No detecté voz. Probá de nuevo.',
      'audio-capture': 'No encontré micrófono disponible.',
      'network': 'Error de red. Verificá tu conexión.',
      'service-not-allowed': 'Servicio de reconocimiento no disponible en este dispositivo.',
      'aborted': 'Reconocimiento cancelado.',
    };
    const msg = messages[event.error] || `Error: ${event.error || 'desconocido'}`;
    // Mostrar feedback en la UI en vez de alert() invasivo
    if (aiInput) {
      const originalPlaceholder = aiInput.placeholder;
      aiInput.placeholder = msg;
      setTimeout(() => {
        if (aiInput) aiInput.placeholder = originalPlaceholder;
      }, 4000);
    }
    if (recognition && isListening) {
      recognition.stop();
    }
  };

  micBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!recognition) return;
    if (isListening) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch (err) {
        console.error('Failed to start recognition:', err);
        if (aiInput) {
          const original = aiInput.placeholder;
          aiInput.placeholder = 'No pude iniciar el micrófono. Reintentá.';
          setTimeout(() => {
            if (aiInput) aiInput.placeholder = original;
          }, 3000);
        }
      }
    }
  });
  }
} else {
  if (micBtn) {
    micBtn.style.display = 'none';
  }
}

// Inicializar altavoz del mensaje de bienvenida
const welcomeSpeakBtn = document.querySelector('#ai-agent-messages .ai-speak-btn') as HTMLButtonElement;
if (welcomeSpeakBtn) {
  const welcomeText = '¡Hola! Soy tu asistente de EdificARTE. ¿Quieres que te recomiende una ruta de monumentos o te cuente la historia de algún lugar de la CDMX? ¡Pregúntame lo que quieras!';
  welcomeSpeakBtn.addEventListener('click', () => {
    speakText(welcomeText, welcomeSpeakBtn);
  });
}

// Submit Handler
aiForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = aiInput.value.trim();
  if (!text) return;

  aiInput.value = '';
  appendUserMessage(text);
  chatHistory.push({ role: 'user', content: text });

  const loaderId = appendAssistantLoader();

  // Obtener coordenadas de localStorage si están disponibles
  const userLat = localStorage.getItem('edificarte_user_lat');
  const userLng = localStorage.getItem('edificarte_user_lng');
  const userLocation = userLat && userLng ? {
    lat: parseFloat(userLat),
    lng: parseFloat(userLng)
  } : null;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: chatHistory,
        userLocation: userLocation
      }),
    });

    if (!response.ok) {
      throw new Error('Response error');
    }

    const data = await response.json();
    const botReply = data.reply || 'Disculpa, se me complicó procesar la respuesta en este momento.';
    const botRoute = data.route || [];

    chatHistory.push({ role: 'assistant', content: botReply });
    updateAssistantMessage(loaderId, botReply, botRoute);

    // Si estamos en la página del mapa, trazar la ruta automáticamente al recibirla
    if (botRoute.length > 0 && window.location.pathname.startsWith('/mapa')) {
      window.dispatchEvent(new CustomEvent('ai-route-generated', { detail: { route: botRoute } }));
    }

  } catch (err) {
    console.error(err);
    updateAssistantMessage(loaderId, '¡Hola! Perdón, pero se perdió la conexión con el servidor. ¿Podrías intentar de nuevo en un momento?');
  }
});
