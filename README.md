# Evolución acuática

Un simulador de evolución con vista de dios: productores, herbívoros, depredadores, mutaciones e intervenciones. HTML, CSS y JavaScript con canvas, sin dependencias ni compilación.

**Versión estable: [1.6.0](https://github.com/babinium/evolucion-acuatica/releases/tag/v1.6.0).** La rama `main` contiene esta versión; la publicación de GitHub permite recuperar su código exacto.

## Jugar

```sh
python3 server.py
```

Abrí [el juego local](http://127.0.0.1:5173) y elegí **Crear mi ecosistema**. No necesitás claves, conexión con proveedores de IA ni instalar paquetes. También funciona como sitio estático; la [versión pública](https://babinium.github.io/evolucion-acuatica/) muestra la versión publicada en `main`.

Como alternativa podés usar Node.js 20 o posterior: `node server.js` o `npm run start:node`. `npm start` inicia el servidor Python.

## PC de bajos recursos

El modo inicial **Bajo consumo** limita el dibujo a 30 FPS y reduce la resolución interna. **Equilibrado** permite hasta 45 FPS y **Más detalle** hasta 60 FPS. Podés cambiarlo desde Ambiente; la preferencia queda guardada en el navegador. Son límites, no una garantía de FPS en todos los equipos.

- La simulación tiene pasos de 30 Hz independientes de la calidad visual. Si el equipo no alcanza, limita el trabajo de recuperación para que los controles sigan respondiendo.
- Una grilla espacial busca alimento, amenazas y vecinos por cercanía. Los sentidos de los animales se escalonan unas cinco veces por segundo y su alcance tiene un límite; el movimiento, la alimentación y los ataques siguen avanzando en cada paso. Los cuerpos se calculan al nacer y se reutilizan.
- Se mantienen únicamente los índices que usan el alimento, las amenazas y los poderes. Se retiraron el índice combinado de animales y los conteos por cuadrante que habían quedado sin uso; no cambian los genes, el alimento ni las reglas de reproducción.
- Solo 16 zonas actualizan las reservas locales de nutrientes, el oxígeno y las corrientes. No se simulan partículas de agua ni redes neuronales por individuo.
- Los peces y las plantas locales se dibujan una vez por especie y se reutilizan. Los paneles se actualizan con menor frecuencia y no usan desenfoque de fondo.
- La pestaña oculta suspende completamente la simulación y el dibujo. Al volver no intenta recuperar todo el tiempo transcurrido. Al pausar, el mapa solo se vuelve a dibujar cuando cambia.
- Para mantener acotada la memoria hay un máximo de 2.400 individuos, 2.400 manchas de algas y 1.200 cadáveres. Al alcanzar el límite de individuos se detienen los nacimientos; no se eliminan individuos vivos para reducir consumo. Los límites son iguales en todas las calidades.

Para una partida liviana, empezá con un mundo compacto o mediano y una especie de cada grupo.

## Controles

- Arrastrar o WASD/flechas: mover la cámara, incluso en pausa.
- Rueda y botones −/+: acercar o alejar. El botón de mira centra el mundo.
- Clic en un individuo o en la lista de especies: inspeccionar rasgos y población.
- **Seguir** en los controles del mapa o **F**: acompañar con la cámara al individuo seleccionado, también en pausa y hasta 10×. El botón cambia a **Siguiendo** mientras está activo. Podés seguir observándolo al acercar o alejar; al arrastrar, moverte con WASD/flechas, centrar el mundo, elegir un poder o pulsar Escape volvés a explorar libremente. Al seleccionar otro individuo, el seguimiento pasa a ese individuo; al morir el observado se detiene. El estado se conserva al guardar y cargar; un mundo nuevo empieza sin seguimiento.
- Clic en el retrato de la ficha: ampliar la ilustración a tres veces su tamaño, ajustada al espacio disponible y sin consumir API. Clic en cualquier lugar o Escape: cerrar la ampliación.
- Barra espaciadora: pausar o reanudar. Los controles de velocidad no cambian la velocidad de la cámara.
- Velocidad de la simulación: los botones − y + de la barra superior cambian de 1× en 1×, entre 1× y 10×. Las velocidades fraccionarias de partidas anteriores se redondean al cargar. A velocidades altas el avance se divide en pasos de hasta 1/6 s para conservar la precisión del movimiento, la alimentación y la reproducción; la cámara mantiene su velocidad habitual.
- Ambiente y Especies: mostrar u ocultar paneles en pantallas pequeñas.
- Intervenciones: teclas 1–6 o botones del panel; clic en el agua para aplicar. Rueda para ajustar el área, Mayús + rueda para zoom y Escape o clic derecho para cancelar.
- Menú **•••**: guardar, cargar, reiniciar con las mismas especies o empezar un mundo nuevo.

Las partidas se guardan en este navegador. Cargar recupera también el individuo seleccionado. Si se agota el espacio de almacenamiento se informa el error y se conserva la partida anterior.

En el menú inicial, la rueda permite recorrer todos los ajustes aunque las opciones de IA estén abiertas. Podés volver a las cantidades de especies sin contraerlas; el contenido se centra solo cuando cabe completo en la ventana.

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

La comida disponible en cada organismo, mancha o cadáver es finita. Un herbívoro consume las reservas accesibles y después el tejido de una planta, o reduce la cantidad de una mancha de algas. Las raíces pueden guardar hasta la mitad de la capacidad de energía fuera del alcance del pastoreo y retienen tejido de anclaje. Esa reserva se gasta en mantenimiento, recuperación y brotes: nunca se rellena gratis ni impide morir por hambre, edad o daños ambientales. Cuando una planta ya no ofrece comida accesible, el herbívoro busca otra fuente y le deja una oportunidad de recuperarse con luz y nutrientes. En las algas base, el pastoreo deja un sustrato vivo no comestible (8% de su tamaño inicial); su rebrote paga nutrientes y necesita luz. La oscuridad o la contaminación pueden agotar también ese sustrato. Una mancha completamente muerta no revive por usar un paso de tiempo mayor. Un carnívoro gasta energía para atacar; recibe alimento al consumir el único cadáver que deja la presa. La defensa, las toxinas, la asimilación y la presencia de competidores modifican la conveniencia de cada comida. Los animales saciados descansan hasta volver a tener hambre. Nadar gasta energía según la velocidad de nado al cuadrado y el tamaño; huida y persecución usan la misma regla. Recuperar salud también cuesta energía y requiere agua adecuada. La vegetación reduce la detección de animales y ofrece refugios y oportunidades de acecho; los cuerpos grandes resultan más visibles. La cobertura se calcula con los productores vivos de cada zona.

Los productores necesitan madurez, salud, reservas y espacio local para reproducirse; la densidad cuenta a otros productores, incluso de otras especies. Pagan la energía **y el tejido comestible** de la cría. La vegetación no bloquea los nacimientos de animales. Los productores forman brotes con menos reservas iniciales y pueden hacerlo con salud parcial, siempre que puedan pagar el brote y conservar un margen propio; así el pastoreo no exige llenar de nuevo todo su depósito para renovar una colonia. Herbívoros y carnívoros usan la ayuda divina descrita abajo y conservan su madurez mínima. Las nuevas variedades comparten un presupuesto inicial: 42 × √(especies productoras) productores y 24 × √(especies herbívoras) herbívoros, redondeados y repartidos entre sus especies. Los depredadores se reparten según las presas disponibles, hasta uno por cada seis herbívoros y un máximo de cuatro por variedad; siempre hay al menos un fundador de cada especie elegida. El inicio de una especie de cada grupo conserva sus 70 individuos. Después, las poblaciones dependen de comida, ambiente, genes y competencia; no se mantiene una proporción obligatoria, no se repueblan especies extintas ni se garantiza supervivencia. Las reglas se calculan localmente sin solicitudes adicionales a la IA.

## Ayuda divina a los animales

La reproducción de herbívoros y carnívoros sigue un reloj determinado por su fertilidad: más fertilidad reduce el intervalo y cero implica esterilidad. Necesitan estar maduros, tener **55% de salud y 75% de energía o más** y haber terminado su espera. Los carnívoros necesitan además la reserva de presas descrita abajo. Al cumplirlo nace una sola cría y empieza un intervalo nuevo. Si falta salud, energía o presas, el reloj queda en cero hasta recuperarse; las oportunidades perdidas no se acumulan. Cada recién nacido espera su propio intervalo completo antes de su primera cría, además de madurar. Los fundadores comienzan en fases distintas para evitar una explosión sincronizada al iniciar.

Para los carnívoros, con fertilidad `F` entre 0 y 20, el intervalo es `2 × [60 + (1 − F/20) × 140]`, equivalente a **`400 − 14 × F` segundos de simulación**. Es el doble del intervalo anterior: fertilidad 5 espera 330 s; 10 espera 260 s; 15 espera 190 s; y 20 espera 120 s. Fertilidad cero sigue impidiendo criar. Se aplica tanto al intervalo entre nacimientos como a la espera completa de las crías; herbívoros y productores conservan sus tiempos.

Cada nacimiento descuenta **25% de la capacidad máxima de energía del progenitor**. La cría recibe **75% de su propia capacidad**, conserva el tamaño heredado y empieza saciada. Es una excepción divina explícita a la conservación de energía y tejido, autorizada para facilitar la renovación de cazadores y presas. No consume API. Las crías animales no dependen del azar ni de la densidad local. Los carnívoros respetan el recuento de presas de abajo y todos conservan el límite total de 2.400 individuos para cuidar la PC.

Para autorizar una nueva cría de carnívoro debe haber **12 herbívoros vivos por cada carnívoro**, contando también esa cría y las otras crías de carnívoros ya aprobadas durante el mismo paso. Es una regla de equilibrio para espaciar el crecimiento cuando faltan presas; no elimina cazadores existentes ni repuebla especies. El inspector indica **Espera presas** cuando esa es la condición pendiente. Mientras espera, el progenitor sigue gastando energía y envejeciendo. Los cadáveres permiten alimentarse, pero no sustituyen una población de presas para este permiso. El cálculo se comparte entre los carnívoros listos, con un único recuento de población por paso cuando hace falta.

El inspector muestra el intervalo y si el individuo espera tiempo, madurez, energía, salud o presas. Las partidas guardadas conservan sus genes, reservas y tiempo pendiente al cargar; el beneficio de energía se aplica a los nuevos nacimientos. El hambre, la vejez, los ataques y el ambiente pueden seguir extinguiendo especies; las extintas no se repueblan automáticamente.

Al cargar una partida anterior, el intervalo completo de los carnívoros se calcula con la fórmula actual. La cuenta que ya estaba en marcha se conserva; el próximo nacimiento inicia la espera duplicada.

## Vida natural y vejez

Cada individuo dispone de **al menos cinco intervalos de reproducción después de madurar**. En segundos de simulación, su límite natural es el mayor entre la longevidad base por tamaño y metabolismo y `tiempo de madurez + 5 × intervalo de cría`. Se conserva la longevidad base de quienes ya vivían más. Por ejemplo, un carnívoro con fertilidad 10, cuyo intervalo es 260 s, dispone de al menos 1.300 s de vida adulta, además de su juventud. Es tiempo para oportunidades de cría: siguen siendo necesarias comida, salud, madurez y fertilidad.

El metabolismo conserva su reloj biológico y su efecto sobre la madurez. La vida y la espera de cría se convierten al mismo reloj antes de compararlas. La ficha muestra **Edad / límite natural** y una barra de **Vida restante**, siempre en segundos de simulación. El último 20% se marca como **Vejez próxima**. La velocidad de juego acelera ambos relojes por igual.

Al alcanzar el límite natural, el individuo muere por vejez, incluso con reservas y salud altas o dentro de un refugio. El hambre, los ataques, las toxinas y el ambiente pueden matarlo antes. Si muere el individuo observado, la ficha muestra la causa inmediata y detiene el seguimiento; el aviso se limpia al elegir otro habitante. Se conserva un único aviso de la selección, sin historial de muertes ni cálculos globales adicionales.

Las partidas anteriores conservan su edad acumulada, genes, salud, energía, imágenes y cuenta de cría pendiente. Al cargar se calcula el nuevo límite, sin reiniciar la edad ni rellenar reservas. La edad mostrada se convierte a segundos de simulación; la edad biológica guardada se conserva para mantener la compatibilidad.

## Rasgos y evolución

Al crear **cualquier mundo nuevo**, local o con IA, el motor ajusta los rasgos iniciales a un presupuesto de mantenimiento, fotosíntesis y reproducción. También comprueba el gasto de las variaciones fundadoras y que los cazadores puedan alcanzar al menos una de las especies de presas. Conserva nombres, descripciones, aspecto y dieta; no sustituye las especies nuevas por plantillas conocidas ni repite llamadas a la IA. Los fundadores empiezan con edades variadas, reservas y alimento cercano, incluso en mundos grandes. Estas restricciones se aplican una sola vez: las crías mutan dentro del rango genético completo. Las partidas guardadas conservan genes y reservas; reiniciar conserva los rasgos de las especies.

Los herbívoros distinguen un cazador que se aproxima de uno que descansa, y pueden alimentarse cerca de un depredador en reposo si no hay peligro inmediato. Los carnívoros pagan el esfuerzo de perseguir y atacar. Priorizan la carroña aprovechable cercana; después buscan herbívoros y, si no encuentran ninguno, pueden oler carroña hasta el doble de su alcance visual. Atacan otros carnívoros, incluso de la misma especie, únicamente con 25% de energía o menos y sin otra comida detectada; la falta de salud por sí sola no activa esa conducta. El progenitor y sus propias crías inmaduras no se cazan entre sí, aunque pertenezcan a una variación nueva. La variación ambiental oscila alrededor del ambiente inicial o de los valores elegidos con los controles (hasta ±24 × variación natural), en lugar de caminar indefinidamente hacia extremos. Elegir valores ambientales extremos sigue pudiendo extinguir poblaciones.

Cada individuo tiene genes propios. La población inicial ya contiene variación; las crías heredan los genes de su progenitor y pueden mutarlos. El inspector muestra esos valores con un decimal, no solo la plantilla de la especie, y explica ventajas y costos al pasar el cursor.

| Rasgo | Ventaja | Costo o límite |
| --- | --- | --- |
| Tamaño | Más salud, reservas, tejido y capacidad de ingestión. | Mayor mantenimiento y menor agilidad; el costo de cría crece con la capacidad de energía. |
| Velocidad | Nadar, perseguir y escapar más rápido. | Mantener músculos rápidos cuesta energía; el escape rápido consume reservas extra. |
| Ataque | Más daño de caza. | Mantenimiento y gasto durante el ataque. Solo existe para carnívoros. |
| Defensa | Reduce el daño físico y la velocidad de consumo de una planta. | Mantenimiento y menor agilidad. |
| Percepción | Detectar alimento y amenazas más lejos; en productores mejora la captación de nutrientes. | Mantenimiento; el alcance de los animales está acotado. |
| Fertilidad | Menor espera entre crías; en animales determina un intervalo fijo. | Mantenimiento y reservas pagadas por cada cría; cero implica esterilidad. Los animales reciben la ayuda divina. |
| Metabolismo | Mayor actividad, digestión y fotosíntesis; madurez más rápida. | Más gasto y demanda de oxígeno. La longevidad respeta los cinco intervalos adultos. |
| Eficiencia | Aprovechar mejor el alimento o la luz. | Mantener ese sistema cuesta energía. No crea comida adicional en la presa. |
| Toxicidad | Disuade a consumidores, reduce su aprovechamiento y los envenena al comer. | Fabricar toxinas cuesta energía; no protege de contaminación. |

Se quitaron del editor los rasgos sin uso para esa dieta: los productores no nadan ni atacan; los herbívoros no usan ataque. Los demás rasgos siguen activos porque sus cálculos son pequeños y sus efectos se usan en la simulación.

La selección actúa sobre la supervivencia y los descendientes de cada individuo. Cuando una cría acumula suficiente diferencia genética respecto de su linaje, aparece una rama nueva; el progenitor conserva su especie y sus genes. También puede ocurrir con evolución lenta, mediante acumulación de cambios. No se cuentan nacimientos ni pequeñas mutaciones: se cuentan separaciones genéticas sucesivas de una misma rama.

**Especie A → variación 1 → variación 2 → especie B.** Al intentar una tercera variación, nace una especie con nombre, descripción e ilustración propios. Conserva su dieta (productor, herbívoro o carnívoro), los genes realmente heredados y la competencia ecológica. La nueva especie vuelve a empezar su contador de variaciones. Las ramas hermanas llevan su propia profundidad; sus números no se suman. El inspector muestra la etapa y el antecesor; el contador general agrupa las variaciones dentro de su especie.

Las dos variaciones comparten la imagen de su especie. **Crear con imágenes** activa también **Ilustrar nuevas especies con IA** para las especies que surjan durante esa partida; se puede desactivar en el panel izquierdo. Cada nueva identidad pide como máximo un texto compacto y una ilustración, en segundo plano y de una en una. Las partidas locales y **Solo especies** usan nuevos nombres, descripciones y dibujos locales sin gastar saldo. Activar la casilla después no regenera automáticamente las identidades locales anteriores. Si falta saldo o falla una respuesta, se conserva el dibujo local y se detiene la cola; desactivar y activar la casilla permite atender las identidades pendientes, sin reenviar las fallidas.

Se conservan como máximo **48 registros de linajes**, incluidas especies y variaciones. Una variación extinta puede liberar un lugar; nunca se elimina una población viva ni una identidad completa para hacer espacio. Al alcanzar el límite, los genes siguen variando dentro de los linajes existentes. No se garantiza que todos los linajes o dietas sobrevivan a cualquier condición.

Las partidas anteriores se migran al cargar: reciben genes individuales y reservas locales; se conservan individuos, selección, ambiente y poderes. Los viejos números globales de variación se interpretan por sus antecesores, sin comprar imágenes retroactivamente. Los nuevos guardados conservan identidad, etapa y estado de preparación; las imágenes compartidas se almacenan una sola vez. Una solicitud guardada mientras estaba en curso se marca interrumpida al cargar y no se reenvía automáticamente.

## IA opcional: una sola clave de OpenRouter

Una clave de **OpenRouter** sirve para crear las especies y sus imágenes. El texto usa por defecto `openai/gpt-4.1-nano`, sin razonamiento adicional, y las ilustraciones `qwen/qwen-image-2.1-turbo` a 1K, su menor resolución admitida. El modelo de imágenes cobra por ilustración; el tamaño del sprite final sigue siendo 192 px. No necesitás una clave ni facturación de Google, ni una API separada de recorte. La simulación y la evolución funcionan también sin conexión, con identidades locales; las ilustraciones de IA durante la partida son opcionales.

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
- Texto: instrucciones compactas, solo los campos utilizados, una respuesta JSON y un límite de `256 + 320 × número de especies` tokens de salida (máximo 4.096). OpenRouter recibe un esquema estricto con un campo obligatorio por cada especie y dieta pedidas; el servidor valida los datos antes de solicitar imágenes. El modelo predeterminado de OpenRouter no usa pensamiento adicional. Google directo pide pensamiento mínimo a Flash-Lite compatible; no significa necesariamente cero.
- Nueva especie por evolución: `/api/evolve-species` pide únicamente nombre, descripción y apariencia. No vuelve a generar rasgos ni cambia la dieta. El límite de texto es 448 tokens con OpenRouter y 512 con Google; la respuesta se guarda por identidad, modelo e instrucciones. Solo entonces se solicita su ilustración. No se envían peticiones para las dos variaciones, familias ya extintas ni pestañas ocultas; una petición ya enviada puede terminar al cambiar de pestaña.
- Imágenes: una ilustración y sin búsquedas ni herramientas. OpenRouter usa la API dedicada de imágenes, `n: 1` y 1K con Qwen; permite configurar 512, 768 o 1K si el modelo elegido lo admite. Google directo usa 512 px y un techo de 4.096 tokens de salida. Para cuidar memoria no se admiten 2K ni 4K. El mapa siempre reutiliza la versión reducida a 192 px.
- La carpeta local `.ai-cache/` conserva respuestas e imágenes válidas entre reinicios; Python y Node pueden reutilizarlas al cambiar de servidor. Se distinguen modelo, instrucciones y ajustes; los cambios relevantes producen otra entrada. Peticiones simultáneas idénticas al mismo servidor comparten una generación. La caché no contiene claves ni cabeceras y tiene un límite de 128 respuestas y 64 MiB; al llenarse elimina las menos recientes. Las imágenes preparadas que ya estén en una partida siguen allí.
- Los pasos de simulación, poderes, dibujos locales, recorte y fichas no consumen saldo. Cargar o reiniciar reutiliza las identidades terminadas; si había identidades pendientes aún no solicitadas y la casilla de IA está activa, su preparación puede continuar. Crear una nueva especie por evolución solo consume saldo con esa opción activada y cuando falta su contenido en la caché.
- La API rechaza acciones enviadas desde otros sitios. La configuración, sus variantes de respaldo, `.env`, la caché y los archivos ocultos no se sirven por HTTP, incluidos los accesos mediante enlaces simbólicos.
- Git ignora la configuración local, sus respaldos, `.env` y la caché. `python3 scripts/check-secrets.py --history` revisa archivos versionados e historial sin mostrar los valores, incluidas claves de Google y OpenRouter. Los hooks de este equipo bloquean commits y pushes con credenciales detectadas o archivos privados. En un clon nuevo se activan con `git config core.hooksPath .githooks`.

Si fallan imágenes, el mundo conserva las especies y usa dibujos locales donde haga falta; el aviso y la ficha explican el resultado. Si falla el texto de especies o no coincide la cantidad por dieta, no se solicitan imágenes. Los datos inválidos y fallos de recorte no provocan otra generación automática.


Para comprobar visualmente el recorrido sin clave ni créditos, ejecutá `python3 tests/preview_images.py` y abrí [la prueba aislada](http://127.0.0.1:5174). En [la prueba de especiación](http://127.0.0.1:5174/?evolution), creá un mundo con imágenes y usá **Avanzar una variación** tres veces para comprobar la secuencia sin esperar generaciones naturales. Usa imágenes **sintéticas**, muestra un aviso permanente y bloquea las conexiones con proveedores. Su puerto separado evita sobrescribir la partida del juego normal. Esta prueba no confirma la calidad artística del proveedor ni una cuota real: eso requiere generar con tu clave.

## Verificación

```sh
npm test
npm run benchmark
node scripts/ecology-audit.mjs --seconds=960
node scripts/ecology-audit.mjs --fixture=all --seeds=42,2026 --chaos=0.55 --seconds=1800
node scripts/ecology-audit.mjs --fresh=3 --seeds=42,2026 --chaos=0.55 --seconds=1200
```

Las pruebas usan las herramientas estándar de Node y Python, sin instalar paquetes. Cubren los siete controles ambientales y los nueve rasgos, alimento finito, persecución, herencia y especiación, costos de reproducción, migración de partidas, poderes, pausa, búsqueda espacial, límites de memoria, pestañas ocultas, igualdad entre calidades, seguimiento de cámara y contratos de Google/OpenRouter con respuestas simuladas, recorte de fondos, bordes suavizados, conservación de colores del cuerpo y reutilización de imágenes entre descendientes. No consumen créditos ni prueban credenciales reales.

El benchmark compara `origin/main` con la copia de trabajo usando la misma semilla, 12 especies, 1.200 individuos y 690 manchas de algas iniciales, en un contexto VM de Node. Mide 140 actualizaciones y descarta las primeras 50 para dar tiempo al calentamiento; informa población final, mediana y percentil 95. Mide CPU de la simulación, no renderizado ni FPS del navegador. Para medir solo la versión actual: `npm run benchmark -- --optimized-only`.

Para comparar contra una revisión concreta, usá `node scripts/benchmark.mjs --compare=a701582`. El mismo ejecutor y generador aleatorio se aplican a ambas versiones. El ejecutor conserva funciones en un ámbito léxico para evitar el costo artificial de resolver cada llamada a través del objeto global de la VM; por eso los tiempos no son comparables con mediciones hechas con el ejecutor anterior.

Para tres rondas alternando el orden de las versiones: `node --expose-gc scripts/benchmark.mjs --compare=v1.4.0 --rounds=3`. Admite de una a cinco rondas; con `--expose-gc` libera los mundos de prueba anteriores entre muestras. Conviene ejecutarlo sin otras pruebas intensivas en paralelo.

`ecology-audit.mjs` sigue tres semillas reproducibles (123456, 42 y 2026), sin variación ambiental aleatoria ni intervenciones, y registra cada minuto poblaciones, recursos, generaciones, linajes, reservas locales y valores finitos. Usa pasos de 1/6 s, el límite de integración ecológica que también se respeta al acelerar a 10×. Podés elegir semillas con `--seeds=42,2026` y una duración con `--seconds=960`. No simula el renderizado ni prueba que el ecosistema permanezca equilibrado indefinidamente.

`--fixture=all` prueba tres combinaciones de rasgos generados por IA, reproducibles sin claves ni imágenes; también se pueden elegir `low-defense-colony`, `two-grazers-two-hunters` y `latest-six-species`. `--fresh=3` crea tres conjuntos independientes de rasgos aleatorios, sin leer cachés ni consultar proveedores; `--fresh-start=11000` cambia sus semillas, `--counts=1,2,3` sus cantidades y `--size=5200` el tamaño del mundo. Todos pasan por las mismas reglas de creación que el juego. `--chaos=0.55` activa la variación ambiental normal. Las pruebas de supervivencia incluyen la colonia que colapsaba bajo pastoreo, renovación durante treinta minutos simulados, oscuridad capaz de extinguirla, depredadores que desaparecen sin presas, conservación de energía y carga de partidas sin regalar reservas ni cambiar genes. Algunas especies pueden extinguirse incluso en condiciones iniciales favorables.
