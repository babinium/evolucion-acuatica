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
- Una grilla espacial busca alimento, amenazas y vecinos por cercanía. Los sentidos de los animales se escalonan unas cinco veces por segundo y su alcance tiene un límite; el movimiento, la alimentación y los ataques siguen avanzando en cada paso. Los cuerpos se calculan al nacer y se reutilizan.
- Solo 16 zonas actualizan las reservas locales de nutrientes, el oxígeno y las corrientes. No se simulan partículas de agua ni redes neuronales por individuo.
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
- Intervenciones: teclas 1–6 o botones del panel; clic en el agua para aplicar. Rueda para ajustar el área, Mayús + rueda para zoom y Escape o clic derecho para cancelar.
- Menú **•••**: guardar, cargar, reiniciar con las mismas especies o empezar un mundo nuevo.

Las partidas se guardan en este navegador. Cargar recupera también el individuo seleccionado. Si se agota el espacio de almacenamiento se informa el error y se conserva la partida anterior.

## Intervenir en el mundo

Los seis poderes funcionan también en pausa, sin invocar APIs. Cada uno tiene un color y recuerda su tamaño de área durante la sesión. Podés elegir un tamaño pequeño, medio o grande, usar el deslizador o ajustar con la rueda (las teclas `[` y `]` también ajustan el radio). La vista previa indica el alcance y el número de objetivos; al aplicar se informa cuántos individuos o recursos cambiaron.

| Tecla | Poder | Efecto |
| --- | --- | --- |
| 1 | Floración | Crea algas distribuidas dentro del área y de los límites del mundo. Sirven de alimento a los herbívoros. |
| 2 | Proteger | Refugio de 80 segundos de simulación: bloquea ataques, catástrofes, falta de oxígeno y toxicidad; regenera salud a quienes están dentro, incluidos los que llegan después. No detiene el hambre ni el envejecimiento. |
| 3 | Catástrofe | Quita 60 de salud a los habitantes sin escudo. Las bajas, los cadáveres y las extinciones se registran de inmediato, incluso en pausa. |
| 4 | Favorecer | Agrega individuos de la especie elegida en el selector del poder; no depende de mantener vivo al individuo seleccionado. |
| 5 | Alimentar | Entrega hasta 45 de energía a cada herbívoro y carnívoro del área, hasta llenar las reservas del individuo (dependen del tamaño). No afecta plantas, individuos muertos o animales con reservas llenas. |
| 6 | Limpiar agua | Zona de 60 segundos de simulación con oxígeno mínimo 60 y toxicidad máxima 20 para los organismos y las algas del área. Las condiciones globales y el exterior de la zona no cambian. |

**Mantener poder activo** permite repetir aplicaciones sin volver a seleccionarlo. Desmarcá la casilla para volver automáticamente a explorar después de una aplicación exitosa. Arrastrar desplaza la cámara sin lanzar el poder. Para cancelar podés usar Escape, clic derecho, el botón × o volver a pulsar el mismo poder.

Las duraciones avanzan al ritmo de la simulación y se congelan en pausa; se conservan al guardar/cargar. Hasta 12 refugios o zonas de agua limpia pueden permanecer activos. Volver a aplicar cerca del centro de una zona del mismo tipo renueva su duración y ajusta su radio. Los límites de población y de algas también se respetan al usar poderes; cuando no hay espacio u objetivos, el aviso lo explica y el poder sigue disponible para intentar en otra zona.

## Ambiente y competencia

Es un modelo de juego: los controles ambientales usan una escala relativa de 0 a 100, no grados Celsius ni concentraciones físicas. El panel cambia el aporte global; el inspector muestra el oxígeno y los nutrientes realmente disponibles en la zona del individuo.

| Control | Mecánica |
| --- | --- |
| Temperatura | El frío ralentiza actividad y gasto; el calor aumenta el gasto. La fotosíntesis tiene un óptimo intermedio y los extremos dañan la salud. |
| Luz | Multiplica la fotosíntesis y la colonización de algas. A cero, ninguna crea energía nueva; las reservas existentes todavía pueden consumirse. |
| Oxígeno | La respiración y la descomposición lo consumen; la fotosíntesis lo devuelve localmente. La escasez reduce movimiento y digestión, impide recuperarse y causa daño. El metabolismo alto exige más oxígeno. |
| Nutrientes | Plantas y algas consumen una reserva compartida en cada zona. Su agotamiento limita el crecimiento; el aporte exterior y una parte de los restos y desechos la reponen. |
| Contaminación | Reduce el crecimiento y daña la salud por encima de 25. Las toxinas del cuerpo son una defensa alimentaria y no dan inmunidad a este control. |
| Corriente | Arrastra animales y cadáveres, mezcla nutrientes entre zonas y renueva el oxígeno. No regala velocidad de nado. Los productores permanecen anclados. |
| Algas nuevas | Controla la colonización de nuevas manchas de algas, pagando nutrientes locales y dependiendo también de luz, temperatura y contaminación. A cero dejan de aparecer manchas naturales nuevas. |

La comida es finita. Un herbívoro consume reservas y después tejido de una planta, o reduce la cantidad de una mancha de algas. En las plantas, el pastoreo deja tejido de anclaje; recuperar hojas y salud gasta la energía obtenida por fotosíntesis. El hambre, la edad y los daños ambientales todavía pueden matarlas. En las algas base, el pastoreo deja un sustrato vivo no comestible (8% de su tamaño inicial); su rebrote paga nutrientes y necesita luz. La oscuridad o la contaminación pueden agotar también ese sustrato. Una mancha completamente muerta no revive por usar un paso de tiempo mayor. Un carnívoro gasta energía para atacar; recibe alimento al consumir el único cadáver que deja la presa. La defensa, las toxinas, la asimilación y la presencia de competidores modifican la conveniencia de cada comida. Los animales saciados descansan hasta volver a tener hambre; huir rápido consume reservas. Recuperar salud también cuesta energía y requiere agua adecuada. La vegetación reduce la detección de animales y ofrece refugios y oportunidades de acecho; los cuerpos grandes resultan más visibles. La cobertura se calcula con los productores vivos de cada zona.

Los nacimientos necesitan madurez, salud, reservas y espacio local; la densidad cuenta a los competidores de otras especies. El progenitor paga la energía **y el tejido comestible** de la cría. Los carnívoros maduran más tarde y espacian más sus crías. No hay un cupo que fuerce una proporción fija entre carnívoros y herbívoros. El inicio estándar tiene 42 productores, 24 herbívoros y 4 carnívoros por especie de cada grupo; el resto depende de comida, ambiente y supervivencia. Las extinciones forman parte del juego.

## Rasgos y evolución

Cada individuo tiene genes propios. La población inicial ya contiene variación; las crías heredan los genes de su progenitor y pueden mutarlos. El inspector muestra esos valores con un decimal, no solo la plantilla de la especie, y explica ventajas y costos al pasar el cursor.

| Rasgo | Ventaja | Costo o límite |
| --- | --- | --- |
| Tamaño | Más salud, reservas, tejido y capacidad de ingestión. | Mayor mantenimiento, menor agilidad, mayor visibilidad y crías más costosas. |
| Velocidad | Nadar, perseguir y escapar más rápido. | Mantener músculos rápidos cuesta energía; el escape rápido consume reservas extra. |
| Ataque | Más daño de caza. | Mantenimiento y gasto durante el ataque. Solo existe para carnívoros. |
| Defensa | Reduce el daño físico y la velocidad de consumo de una planta. | Mantenimiento y menor agilidad. |
| Percepción | Detectar alimento y amenazas más lejos; en productores mejora la captación de nutrientes. | Mantenimiento; el alcance de los animales está acotado. |
| Fertilidad | Más oportunidades de nacimiento y menor espera entre crías. | Mantenimiento y reservas pagadas por cada cría; cero implica esterilidad. |
| Metabolismo | Mayor actividad, digestión y fotosíntesis. | Más gasto y demanda de oxígeno, envejecimiento más rápido. |
| Eficiencia | Aprovechar mejor el alimento o la luz. | Mantener ese sistema cuesta energía. No crea comida adicional en la presa. |
| Toxicidad | Disuade a consumidores, reduce su aprovechamiento y los envenena al comer. | Fabricar toxinas cuesta energía; no protege de contaminación. |

Se quitaron del editor los rasgos sin uso para esa dieta: los productores no nadan ni atacan; los herbívoros no usan ataque. Los demás rasgos siguen activos porque sus cálculos son pequeños y sus efectos se usan en la simulación.

La selección actúa sobre la supervivencia y los descendientes de cada individuo. Cuando una cría acumula suficiente diferencia genética respecto de su linaje, aparece una rama nueva; el progenitor conserva su especie y sus genes. También puede ocurrir con evolución lenta, mediante acumulación de cambios. Se frena la creación de ramas al registrar 48 especies; los genes siguen variando dentro de los linajes existentes. Las mutaciones reutilizan las imágenes y no llaman a ninguna API. No se garantiza que todos los linajes o dietas sobrevivan a cualquier condición.

Las partidas anteriores se migran al cargar: reciben genes individuales y reservas locales; se conservan individuos, selección, ambiente y poderes. Una partida guardada con este modelo conserva sus genes y reservas de agua.

## IA opcional: una sola clave de OpenRouter

Una clave de **OpenRouter** sirve para crear las especies y sus imágenes. El texto usa por defecto `openai/gpt-4.1-nano`, sin razonamiento adicional, y las ilustraciones `qwen/qwen-image-2.1-turbo` a 1K, su menor resolución admitida. El modelo de imágenes cobra por ilustración; el tamaño del sprite final sigue siendo 192 px. No necesitás una clave ni facturación de Google, ni una API separada de recorte. La simulación, la evolución y los reinicios funcionan sin conexión y no hacen generaciones.

```sh
cp config.local.example.json config.local.json
```

Pegá tu clave en ese archivo local y reiniciá `python3 server.py`:

```json
{
  "aiProvider": "openrouter",
  "openrouterApiKey": "tu-clave-de-openrouter",
  "openrouterModel": "openai/gpt-4.1-nano",
  "openrouterImageModel": "qwen/qwen-image-2.1-turbo",
  "openrouterImageSize": "1K"
}
```

También se admite `OPENROUTER_API_KEY` como variable de entorno en ambos servidores; tiene prioridad sobre el archivo. `config.local.json` está ignorado por Git y bloqueado por los servidores web. La clave se envía únicamente desde el servidor a OpenRouter, en la cabecera de autorización; no se entrega al navegador. Creala en [OpenRouter](https://openrouter.ai/settings/keys), con saldo y un límite de gasto adecuado. El juego no compra créditos ni cambia ese límite. Los modelos y sus parámetros se verificaron contra el [catálogo de imágenes](https://openrouter.ai/api/v1/images/models) y la [documentación oficial](https://openrouter.ai/docs/guides/overview/multimodal/image-generation).

**Google directo sigue disponible** con `aiProvider: "google"`, `geminiApiKey` o `GEMINI_API_KEY`, `geminiModel: "gemini-3.1-flash-lite"`, `geminiImageModel: "gemini-3.1-flash-image"` y `geminiImageSize: "512"`. Necesita facturación y cuota de imágenes en ese proyecto de Google. Las configuraciones antiguas que solo tienen clave de Gemini conservan su proveedor. Nunca se cambia automáticamente de OpenRouter a Google ante un error.

En **Crear con inteligencia artificial**, **Comprobar conexión** consulta la autenticación y los metadatos del proveedor sin generar contenido ni imágenes. En OpenRouter también comprueba que el modelo de texto exista y que el modelo de imágenes acepte la resolución y generación sin referencias. El saldo, las restricciones particulares de la clave y los permisos de generación se comprueban al generar. La detección inicial solo comprueba si existe una clave.

**Crear con imágenes** reutiliza las especies ya guardadas cuando coinciden los ajustes. La casilla **Reutilizar especies anteriores** está activada por defecto; desmarcarla pide especies nuevas y consume cuota. Cada descripción de imagen idéntica reutiliza siempre su ilustración guardada. Las generaciones necesarias se hacen en serie. El mapa y la ficha usan esa misma ilustración, evitando diferencias de aspecto y una segunda generación de pago. **Solo especies** usa dibujos locales. El editor también permite elegir entre imágenes de IA y dibujos locales. La primera creación con una especie de cada grupo necesita como máximo una respuesta de texto y tres ilustraciones. Repetirla con los mismos ajustes reutiliza los resultados disponibles sin otra generación.

### Preparación y dibujo de imágenes

- Se pide un único cuerpo opaco, visto desde arriba, cabeza hacia la derecha, sin sombras ni escenario, con margen alrededor y fondo magenta uniforme. Se permite que el cuerpo sea azul o verde, evitando el color elegido como fondo.
- Los modelos elegidos no garantizan salida con transparencia. El navegador elimina el fondo conectado a los bordes con una tolerancia ajustada; no borra todos los píxeles azules, blancos o magenta del interior del cuerpo.
- Se conserva la transparencia existente, se suavizan los bordes contaminados por el fondo y se descartan motas aisladas pequeñas. Las imágenes sin fondo uniforme, vacías o cortadas por el borde se rechazan y se informa del fallo.
- Las instrucciones distinguen animales de colonias vegetales para evitar que el modelo agregue plantas junto a un pez. En animales, una separación por grosor y colores del cuerpo también elimina decoraciones contrastadas unidas por puentes estrechos; conserva aletas firmes y partes del mismo color. No se aplica a productores, que pueden tener hojas sobre tallos finos. Es una limpieza conservadora, no un reconocimiento universal de objetos; el modelo puede incumplir la pose pedida.
- Se recorta al contorno visible y se centra sin deformar la proporción. Se guardan PNG transparentes de **192 × 192 para el mapa** y **384 × 384 para la ficha**, con un pequeño margen de seguridad. La imagen original no se conserva en la partida.
- El trabajo de píxeles ocurre una sola vez al preparar la imagen. El mapa reutiliza el canvas; las especies descendientes comparten la misma entrada de caché. Las imágenes preparadas se conservan al guardar/cargar y no se recortan otra vez.
- Al seleccionar un individuo o una especie se abre su ficha y se muestra la ilustración; **Ver todas las especies** vuelve a la lista sin desplazar el mundo.
- Las partidas anteriores con fondo azul, blanco o transparencia siguen usando el procesamiento al cargar sus sprites. Las ilustraciones antiguas siguen disponibles en sus fichas.

### Consumo de API y protección de claves

- Cada acción envía **como máximo una solicitud de generación por respuesta que falta**. No hay reenvíos automáticos ante errores, cortes o esperas agotadas. OpenRouter recibe un modelo explícito, prioridad de precio y `allow_fallbacks: false`; no se usan routers automáticos ni herramientas auxiliares. El jugador decide si vuelve a intentar. La falta de saldo también detiene las imágenes restantes del mundo.
- Texto: instrucciones compactas, solo los campos utilizados, una respuesta JSON y un límite de `256 + 320 × número de especies` tokens de salida (máximo 4.096). El modelo predeterminado de OpenRouter no usa pensamiento adicional. Google directo pide pensamiento mínimo a Flash-Lite compatible; no significa necesariamente cero.
- Imágenes: una ilustración y sin búsquedas ni herramientas. OpenRouter usa la API dedicada de imágenes, `n: 1` y 1K con Qwen; permite configurar 512, 768 o 1K si el modelo elegido lo admite. Google directo usa 512 px y un techo de 4.096 tokens de salida. Para cuidar memoria no se admiten 2K ni 4K. El mapa siempre reutiliza la versión reducida a 192 px.
- La carpeta local `.ai-cache/` conserva respuestas e imágenes válidas entre reinicios; Python y Node pueden reutilizarlas al cambiar de servidor. Se distinguen modelo, instrucciones y ajustes; los cambios relevantes producen otra entrada. Peticiones simultáneas idénticas al mismo servidor comparten una generación. La caché no contiene claves ni cabeceras y tiene un límite de 128 respuestas y 64 MiB; al llenarse elimina las menos recientes. Las imágenes preparadas que ya estén en una partida siguen allí.
- Simular, evolucionar, usar poderes, reiniciar y cargar una partida no generan contenido ni consumen saldo de los proveedores. El recorte y las fichas se calculan localmente.
- La API rechaza acciones enviadas desde otros sitios. La configuración, sus variantes de respaldo, `.env`, la caché y los archivos ocultos no se sirven por HTTP, incluidos los accesos mediante enlaces simbólicos.
- Git ignora la configuración local, sus respaldos, `.env` y la caché. `python3 scripts/check-secrets.py --history` revisa archivos versionados e historial sin mostrar los valores, incluidas claves de Google y OpenRouter. Los hooks de este equipo bloquean commits y pushes con credenciales detectadas o archivos privados. En un clon nuevo se activan con `git config core.hooksPath .githooks`.

Si fallan imágenes, el mundo conserva las especies y usa dibujos locales donde haga falta; el aviso y la ficha explican el resultado. Si falla el texto de especies o no coincide la cantidad por dieta, no se solicitan imágenes. Los datos inválidos y fallos de recorte no provocan otra generación automática.


Para comprobar visualmente el recorrido sin clave ni créditos, ejecutá `python3 tests/preview_images.py` y abrí [la prueba aislada](http://127.0.0.1:5174). Usa imágenes **sintéticas**, muestra un aviso permanente y bloquea las conexiones con proveedores. Su puerto separado evita sobrescribir la partida del juego normal. Esta prueba no confirma la calidad artística del proveedor ni una cuota real: eso requiere generar con tu clave.

## Verificación

```sh
npm test
npm run benchmark
node scripts/ecology-audit.mjs --seconds=960
```

Las pruebas usan las herramientas estándar de Node y Python, sin instalar paquetes. Cubren los siete controles ambientales y los nueve rasgos, alimento finito, persecución, herencia y especiación, costos de reproducción, migración de partidas, poderes, pausa, búsqueda espacial, límites de memoria, pestañas ocultas, igualdad entre calidades y contratos de Google/OpenRouter con respuestas simuladas, recorte de fondos, bordes suavizados, conservación de colores del cuerpo y reutilización de imágenes entre descendientes. No consumen créditos ni prueban credenciales reales.

El benchmark compara `origin/main` con la copia de trabajo usando la misma semilla, 12 especies, 1.200 individuos y 690 manchas de algas, en un contexto VM de Node. Mide 40 actualizaciones y descarta las primeras diez; informa mediana y percentil 95. Mide CPU de la simulación, no renderizado ni FPS del navegador. Para medir solo la versión actual: `npm run benchmark -- --optimized-only`.

Para comparar contra una revisión concreta, usá `node scripts/benchmark.mjs --compare=a701582`. El mismo ejecutor y generador aleatorio se aplican a ambas versiones. El ejecutor conserva funciones en un ámbito léxico para evitar el costo artificial de resolver cada llamada a través del objeto global de la VM; por eso los tiempos no son comparables con mediciones hechas con el ejecutor anterior.

`ecology-audit.mjs` sigue tres semillas reproducibles (123456, 42 y 2026), sin variación ambiental aleatoria ni intervenciones, y registra cada minuto poblaciones, recursos, generaciones, linajes, reservas locales y valores finitos. Usa pasos de 1/6 s, el paso máximo a velocidad 5×. Podés elegir semillas con `--seeds=42,2026` y una duración con `--seconds=960`. No simula el renderizado ni prueba que el ecosistema permanezca equilibrado indefinidamente.
