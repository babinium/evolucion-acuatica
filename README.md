# Evolución acuática

Un simulador de evolución con vista de dios: productores, herbívoros, depredadores, mutaciones e intervenciones. HTML, CSS y JavaScript con canvas, sin dependencias ni compilación.

## Jugar

```sh
python3 server.py
```

Abrí [el juego local](http://127.0.0.1:5173) y elegí **Crear mi ecosistema**. No necesitás claves, conexión con proveedores de IA ni instalar paquetes. También funciona como sitio estático; la [demo pública](https://babinium.github.io/evolucion-acuatica/) muestra la versión publicada en `main`.

Como alternativa podés usar Node.js 20 o posterior: `node server.js` o `npm run start:node`. `npm start` inicia el servidor Python.

## PC de bajos recursos

El modo inicial **Bajo consumo** limita el dibujo a 30 FPS y reduce la resolución interna. **Equilibrado** permite hasta 45 FPS y **Más detalle** hasta 60 FPS. Podés cambiarlo desde Ambiente; la preferencia queda guardada en el navegador. Son límites, no una garantía de FPS en todos los equipos.

- La simulación tiene pasos de 30 Hz independientes de la calidad visual. Si el equipo no alcanza, limita el trabajo de recuperación para que los controles sigan respondiendo.
- Una grilla espacial busca alimento, amenazas y vecinos por cercanía. Las especies y las poblaciones de cada cuadrante tienen índices reutilizables.
- Los peces y las plantas locales se dibujan una vez por especie y se reutilizan. Los paneles se actualizan con menor frecuencia y no usan desenfoque de fondo.
- La pestaña oculta suspende completamente la simulación y el dibujo. Al volver no intenta recuperar todo el tiempo transcurrido. Al pausar, el mapa solo se vuelve a dibujar cuando cambia.
- Para mantener acotada la memoria hay un máximo de 2.400 individuos, 2.400 manchas de algas y 1.200 cadáveres. Al alcanzar el límite de individuos se detienen los nacimientos; no se eliminan individuos vivos para reducir consumo. Los límites son iguales en todas las calidades.

Para una partida liviana, empezá con un mundo compacto o mediano y una especie de cada grupo.

## Controles

- Arrastrar o WASD/flechas: mover la cámara, incluso en pausa.
- Rueda y botones −/+: acercar o alejar. El botón de mira centra el mundo.
- Clic en un individuo o en la lista de especies: inspeccionar rasgos y población.
- Barra espaciadora: pausar o reanudar. Los controles de velocidad no cambian la velocidad de la cámara.
- Ambiente y Especies: mostrar u ocultar paneles en pantallas pequeñas.
- Intervenciones: elegir una acción, ajustar el radio con la rueda y aplicarla en el agua. Escape cancela.
- Menú **•••**: guardar, cargar, reiniciar con las mismas especies o empezar un mundo nuevo.

Las partidas se guardan en este navegador. Cargar recupera también el individuo seleccionado. Si se agota el espacio de almacenamiento se informa el error y se conserva la partida anterior.

## IA opcional

La IA solo se llama al crear especies o sus imágenes mediante los botones correspondientes. La simulación, las mutaciones y los reinicios no llaman APIs. La generación consume las cuotas o créditos de tu cuenta del proveedor.

```sh
cp config.local.example.json config.local.json
```

Editá ese archivo y reiniciá el servidor:

```json
{
  "geminiApiKey": "tu-clave-de-gemini",
  "togetherApiKey": "tu-clave-de-together",
  "geminiModel": "gemini-3.1-flash-lite",
  "togetherModel": "black-forest-labs/FLUX.2-dev"
}
```

Con Gemini podés crear especies con dibujos locales. Con ambas claves podés pedir retratos y sprites. La interfaz indica si hay claves configuradas; la validez, los créditos y la disponibilidad del modelo se comprueban al generar.

Los modelos son configurables para no depender de un nombre fijo. Los valores del ejemplo se contrastaron con la [documentación de modelos de Gemini](https://ai.google.dev/gemini-api/docs/deprecations) y el [catálogo de Together](https://docs.together.ai/docs/serverless/models). Los servidores Python y Node usan el mismo contrato del [endpoint de imágenes](https://docs.together.ai/reference/post-images-generations): PNG en base64, 512 × 512 para sprites y 768 × 576 para retratos. Así las imágenes quedan en la partida y no requieren descargar una URL temporal ni acceder a píxeles de otro dominio.

Los errores temporales 429/500/502/503/504 se reintentan hasta tres veces en el servidor, con espera progresiva. Los errores de credenciales o de modelo no se reintentan. El cliente no vuelve a generar el par de imágenes automáticamente. Si falla Together al crear un mundo, se conservan las especies de Gemini y se usan dibujos locales. Si falla Gemini, podés cerrar el aviso e iniciar un mundo local.

Las claves se obtienen en [Google AI Studio](https://aistudio.google.com/app/apikey) y [Together](https://api.together.ai/settings/api-keys). `config.local.json` está ignorado por Git y ambos servidores bloquean su acceso web. Las claves se envían a los proveedores mediante cabeceras del servidor. No deben colocarse en el frontend ni publicarse en GitHub Pages.

## Verificación

```sh
npm test
npm run benchmark
```

Las pruebas usan las herramientas estándar de Node y Python, sin instalar paquetes. Cubren partidas sin claves, guardado/carga, pausa, búsqueda espacial frente a búsqueda exhaustiva, límites de memoria, pestañas ocultas, igualdad entre calidades y los contratos de las APIs con respuestas simuladas. No consumen créditos ni prueban credenciales reales.

El benchmark compara `origin/main` con la copia de trabajo usando la misma semilla, 12 especies, 1.200 individuos y 690 manchas de algas, en un contexto VM de Node. Mide 40 actualizaciones y descarta las primeras diez; informa mediana y percentil 95. Mide CPU de la simulación, no renderizado ni FPS del navegador. Para medir solo la versión actual: `npm run benchmark -- --optimized-only`.
