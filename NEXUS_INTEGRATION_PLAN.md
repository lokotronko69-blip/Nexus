# PLAN DE INTEGRACIÓN DE NEXUS: AGENTE DE NAVEGADOR Y COMPAÑERA TOTAL

Este documento detalla la hoja de ruta para convertir a Nexus en una entidad con control total sobre el navegador y capacidades de asistencia avanzadas.

## 1. CATEGORÍAS DE TAREAS Y EJECUCIÓN

Nexus identificará la intención del usuario y seleccionará la estrategia adecuada:

### A. AUTOMATIZACIÓN WEB Y NAVEGACIÓN (Browser Agent)
**Objetivo:** Navegar, interactuar y extraer información de la web de forma autónoma.
**Herramientas:** `browserControl`, `executeDynamicCode`.
**Flujo de Ejecución:**
1.  **Navegación:** Usar `browserControl(action: 'navigate')` para ir a URLs.
2.  **Interacción:**
    *   Usar `browserControl(action: 'inputText')` para rellenar formularios.
    *   Usar `browserControl(action: 'click')` para botones y enlaces.
    *   Si el selector es complejo, usar `executeDynamicCode` para encontrarlo.
3.  **Lectura:** Usar `browserControl(action: 'read')` para extraer texto.
4.  **Control de Pestañas:** Abrir/cerrar pestañas para mantener el flujo sin perder a Nexus.

### B. PERCEPCIÓN VISUAL Y ASISTENCIA (Ojos de Nexus)
**Objetivo:** Ver el mundo físico o digital del usuario para asistir en tiempo real.
**Herramientas:** `toggleCamera`, `toggleScreenShare`.
**Flujo de Ejecución:**
1.  **Solicitud:** Si el usuario dice "mira esto" o "¿qué ves?", activar la cámara/pantalla.
2.  **Análisis:** El modelo multimodal recibe el stream de video y procesa los frames.
3.  **Feedback:** Nexus describe lo que ve y responde a preguntas sobre ello.

### C. LÓGICA, CÁLCULO Y SCRIPTING (Cerebro Lógico)
**Objetivo:** Resolver problemas matemáticos, generar herramientas o manipular datos.
**Herramientas:** `executeDynamicCode`.
**Flujo de Ejecución:**
1.  **Generación:** Nexus escribe código JavaScript para resolver la tarea (ej: calcular hipoteca, generar un gráfico con Canvas).
2.  **Ejecución:** El código se ejecuta en el navegador del usuario.
3.  **Resultado:** El resultado se devuelve a Nexus para que lo explique.

### D. MEMORIA Y CONTEXTO (Alma de Nexus)
**Objetivo:** Recordar preferencias, hechos y la historia de la relación.
**Herramientas:** `saveMemory`, `retrieveMemories`.
**Flujo de Ejecución:**
1.  **Escucha Activa:** Detectar datos relevantes en la conversación.
2.  **Guardado Proactivo:** Usar `saveMemory` sin preguntar.
3.  **Recuperación:** Consultar memorias al iniciar sesión o cuando sea necesario.

---

## 2. MEJORAS TÉCNICAS E IMPLEMENTACIÓN

### Fase 1: Control de Navegador Robusto (EN PROGRESO)
- [x] Implementar `navigate` (en nueva pestaña).
- [x] Implementar `inputText` (con eventos de teclado).
- [ ] Mejorar `click` para soportar coordenadas o búsqueda de texto.
- [ ] Implementar `read` inteligente (extraer contenido principal, no todo el HTML).

### Fase 2: Estabilidad de Visión (PRIORIDAD)
- [ ] Solucionar fallos de carga de cámara (fallback a 'user' si 'environment' falla).
- [ ] Mejorar feedback visual cuando la cámara/pantalla está activa.
- [ ] Asegurar que el stream de video se envía correctamente al modelo.

### Fase 3: Memoria Persistente Avanzada
- [ ] Implementar búsqueda semántica en memorias (si crece mucho).
- [ ] Permitir al usuario ver y editar sus memorias.

### Fase 4: Personalidad y Voz
- [ ] Ajustar la voz y el tono para que coincida con la personalidad "chica de barrio".
- [ ] Mejorar la detección de interrupciones.

---

## 3. PROTOCOLO DE ERRORES
- Si una acción de navegador falla, Nexus debe intentar una alternativa (ej: usar JS si `browserControl` falla).
- Si la cámara falla, Nexus debe explicar claramente el problema (permisos, dispositivo) y pedir reintentar.
