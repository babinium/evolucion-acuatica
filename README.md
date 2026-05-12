# Evolucion acuatica

Simulador evolutivo acuatico con vista dios, especies generadas por IA, recursos, productores, herbivoros, carnivoros, mutaciones e intervenciones del jugador.

Este repositorio es publico para que cualquiera pueda descargar el juego y usar sus propias APIs. No es una pagina web ya hospedada: cada jugador lo ejecuta en su computadora para que sus claves privadas no se suban ni se compartan.

## Requisitos

- Python 3 instalado.
- Una clave de Gemini para crear especies con texto.
- Una clave de Together AI para crear imagenes con FLUX.

El juego tambien tiene una opcion `Demo sin IA`, que funciona sin claves.

## Descargar y jugar

```sh
git clone https://github.com/babinium/evolucion-acuatica.git
cd evolucion-acuatica
cp config.local.example.json config.local.json
```

Abre `config.local.json` y pega tus claves:

```json
{
  "togetherApiKey": "tu-clave-de-together",
  "geminiApiKey": "tu-clave-de-gemini"
}
```

Inicia el servidor local:

```sh
python3 server.py
```

Abre el juego en el navegador:

```text
http://127.0.0.1:5173
```

## Como conseguir las APIs

Gemini:

1. Entra a `https://aistudio.google.com/app/apikey`.
2. Crea una API key.
3. Pegala en `geminiApiKey`.

Together AI:

1. Entra a `https://api.together.ai/settings/api-keys`.
2. Crea una API key.
3. Pegala en `togetherApiKey`.

## Que hace cada clave

- `geminiApiKey`: genera nombres, descripciones, rasgos y comportamiento de especies.
- `togetherApiKey`: genera retratos y sprites de las especies.

Si solo agregas Gemini, puedes usar `IA sin imagenes`. Si agregas ambas, puedes usar `Crear mundo con IA`.

## Seguridad de claves

`config.local.json` esta ignorado por git y no debe subirse al repositorio. Cada jugador crea su propio archivo local con sus propias claves.

El servidor bloquea el acceso web a `config.local.json`, asi que el navegador no puede descargar ese archivo directamente.

## Errores comunes

- Si ves que el enlace de GitHub no abre el juego, es normal: GitHub muestra el codigo. Para jugar hay que clonar el repositorio y abrir `http://127.0.0.1:5173` despues de ejecutar `python3 server.py`.
- Si aparece `Missing Gemini API key`, falta `geminiApiKey` en `config.local.json`.
- Si aparece `Missing Together/Flux API key`, falta `togetherApiKey` en `config.local.json`.
- Si cambiaste las claves mientras el servidor estaba abierto, cierra el servidor y vuelve a correr `python3 server.py`.

## Alternativa con Node.js

Tambien puedes iniciar el servidor con Node.js:

```sh
npm start
```

o directamente:

```sh
node server.js
```
