import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from './harness.mjs';

function scene() {
  const game=createGame();
  game.run(`seedWorld(fallbackSpecies(1,1,1));state.selected=state.creatures.find(c=>getSpecies(c).class==='herbivore');updateSelection()`);
  return game;
}

test('following requires a living selection and tracks its movement without changing zoom',()=>{
  const game=scene();
  const result=game.run(`(()=>{
    const zoom=state.camera.zoom;setFollowSelected(true);update(1/30);
    const tracked=state.followSelected && state.camera.x===state.selected.x && state.camera.y===state.selected.y;
    state.creatures=[];updateFollowCamera();
    return {tracked,zoom:zoom===state.camera.zoom,stopped:!state.followSelected};
  })()`);
  assert.ok(result.tracked && result.zoom && result.stopped);
  assert.equal(game.element('followSelectedBtn').disabled,true);
});

test('the F shortcut toggles following, ignores repeats and leaves text inputs alone',()=>{
  const game=scene();let prevented=0;
  const event={key:'f',preventDefault(){prevented++;},target:{closest:()=>null}};
  const key=game.listeners.get('window:keydown');
  key(event);assert.equal(game.run('state.followSelected'),true);
  key({...event,repeat:true});assert.equal(game.run('state.followSelected'),true);
  key({...event,target:{closest:()=>({})}});assert.equal(game.run('state.followSelected'),true);
  key(event);assert.equal(game.run('state.followSelected'),false);assert.equal(prevented,2);
});

test('manual keyboard movement stops tracking and remains available in pause',()=>{
  const game=scene();
  game.run('setFollowSelected(true);state.paused=true;keys.add("d")');
  const before=game.run('state.camera.x');game.run('update(1/30)');
  assert.equal(game.run('state.followSelected'),false);
  assert.ok(game.run('state.camera.x')>before);assert.equal(game.run('state.day'),0);
});

test('a click does not stop tracking but dragging takes control of the camera',()=>{
  const game=scene();game.run('setFollowSelected(true)');
  const down=game.listeners.get('world:pointerdown'),move=game.listeners.get('window:pointermove');
  down({button:0,clientX:400,clientY:400});
  game.listeners.get('window:pointerup')();
  assert.equal(game.run('state.followSelected'),true);
  down({button:0,clientX:400,clientY:400});
  move({clientX:440,clientY:420});
  assert.equal(game.run('state.followSelected'),false);
});

test('zoom keeps following while centering the world returns to free exploration',()=>{
  const game=scene();game.run('setFollowSelected(true);state.paused=true');
  game.listeners.get('zoomIn:click')();
  game.listeners.get('world:wheel')({preventDefault(){},clientX:800,clientY:450,deltaY:-1});
  assert.equal(game.run('state.followSelected'),true);
  assert.equal(game.run('state.camera.x===state.selected.x && state.camera.y===state.selected.y'),true);
  game.listeners.get('centerCamera:click')();
  assert.equal(game.run('state.followSelected'),false);
  assert.equal(game.run('state.camera.x'),game.run('state.worldSize/2'));
});

test('power targeting stops following and choosing follow exits the active power',()=>{
  const game=scene();game.run('setFollowSelected(true);selectTool("feed")');
  assert.equal(game.run('state.followSelected'),false);
  game.run('setFollowSelected(true)');
  assert.equal(game.run('state.activeTool'),null);
  assert.equal(game.run('state.followSelected'),true);
});

test('following stops at death and never jumps to another member of the species',()=>{
  const game=scene();game.run('setFollowSelected(true);state.selected.health=0;update(1/30)');
  assert.equal(game.run('state.followSelected'),false);
  assert.equal(game.element('followSelectedBtn').disabled,true);
});

test('saves reconnect following to the selected individual while legacy saves remain free',()=>{
  const game=scene();game.run('setFollowSelected(true);saveWorld();togglePanel("ecosystemPanel","toggleSpecies",false);state.selected=null;loadWorld()');
  assert.equal(game.run('state.followSelected'),true);
  assert.equal(game.run('state.creatures.includes(state.selected) && state.camera.x===state.selected.x'),true);
  assert.equal(game.element('ecosystemPanel').classList.contains('collapsed'),false);
  const saved=JSON.parse(game.values.get('evo-save'));delete saved.followSelected;
  game.values.set('evo-save',JSON.stringify(saved));game.run('loadWorld()');
  assert.equal(game.run('state.followSelected'),false);
});

test('new ecosystems reset following and the button works while paused',()=>{
  const game=scene();game.run('setFollowSelected(true);seedWorld(fallbackSpecies(1,1,1))');
  assert.equal(game.run('state.followSelected'),false);
  assert.equal(game.element('followSelectedBtn').disabled,true);
  game.run('state.selected=state.creatures[0];state.paused=true;updateSelection()');
  game.listeners.get('followSelectedBtn:click')();
  assert.equal(game.run('state.followSelected'),true);
});

test('refreshing an empty inspector in pause does not redraw an unchanged map',()=>{
  const game=scene();
  assert.equal(game.run('state.selected=null;state.paused=true;renderDirty=false;updateSelection();renderDirty'),false);
});

test('following at 10x changes only the camera, never the ecology or API usage',()=>{
  const free=scene(),follow=scene();
  free.run('setSimulationSpeed(10)');follow.run('setSimulationSpeed(10);setFollowSelected(true)');
  const run=`for(let i=0;i<60;i++)update(1/30);JSON.stringify({creatures:state.creatures,resources:state.resources,
    corpses:state.corpses,habitats:state.habitats,species:state.species,day:state.day,aiCalls:state.aiCalls})`;
  assert.equal(free.run(run),follow.run(run));
});
