# Funcionamiento App Semaplan

Este documento resume la aplicacion operativa real de Semaplan para no
depender de releer todo `login.html` cada vez.

Complementa, no reemplaza, a
`Documentacion/Planes/Reglas_Operativas_Semaplan.md`.

`Reglas_Operativas_Semaplan.md` define criterios de UX, guardado y
consistencia.

Este archivo define panorama funcional, modulos, estructuras de estado
y funciones de entrada relevantes.

Debe mantenerse actualizado cuando cambien flujos operativos,
estructuras persistidas o relaciones importantes entre modulos.

## Entrypoints y archivos

- `index.html`: landing publica.
- `Semaplan.html`: redireccion liviana a `login.html`.
- `login.html`: aplicacion operativa principal.
- `Aplicaciones/Desktop/Main_Process.js`: abre `login.html` directamente
  en la aplicacion Electron. El portable estable se genera como
  `Aplicaciones/Desktop/Dist_Desktop/Semaplan-Desktop.exe`.
- `supabase/functions/semaplan-ai`: gateway de IA en produccion para
  consultas y mutaciones B2 acotadas sobre datos de Semaplan en
  `https://cprdnxkkhuuhdispubds.supabase.co/functions/v1/semaplan-ai`.
  Ya valida tokens/JWT/OAuth, puede leer `estado_usuario` con filtrado
  seguro y expone `/agenda`, `/contexto`, `/tareas`, `/habitos`,
  `/slots`, `/planes/semana`, `/planes/periodos`, `/archivero`,
  `/archivero/buscar`, `/baul`, `/openapi.json`, `/openapi-key.json`,
  `/oauth/authorize` y `/oauth/token` con vistas compactas y contrato
  publico para IA. El resumen legado `/metas` no se publica en el
  OpenAPI y no es la fuente canonica; solo queda como alias tecnico de
  compatibilidad para Actions cacheadas, resolviendo contra
  `Planes_Periodo`. La fuente canonica de objetivos, subobjetivos,
  partes y avances es `Planes_Periodo`. En B2 tambien expone
  `POST /b2/tareas/crear`,
  `/b2/tareas/marcar`, `/b2/tareas/reprogramar`,
  `/b2/tareas/editar`, `/b2/tareas/borrar`,
  `/b2/tareas/duplicar` y `/b2/lote`,
  `/b2/habitos/crear`, `/b2/habitos/registrar`,
  `/b2/planes/objetivos`, `/b2/planes/subobjetivos`,
  `/b2/planes/partes`, `/b2/planes/avances`,
  `/b2/archivero/nota` y `/b2/baul/item`.
  Las acciones internas de Decoteca viven dentro de `/b2/lote` para no
  aumentar el número de operaciones OpenAPI: crean, editan y borran
  obras y tecas con `crear_obra_decoteca`, `editar_obra_decoteca`,
  `borrar_obra_decoteca`, `crear_teca_decoteca`,
  `editar_teca_decoteca` y `borrar_teca_decoteca`.
  Las mutaciones requieren scopes separados, usan control optimista de
  `version`, guardan mediante la RPC `aplicar_estado_usuario_b2` para
  evitar el merge preservador general de `estado_usuario` en este flujo
  controlado, aceptan `idempotency_key` y registran auditoria en
  `ia_mutaciones_usuario`.
  El OpenAPI debe publicar siempre la URL publica de Edge Functions
  (`/functions/v1/semaplan-ai`), no la URL interna que Supabase entrega
  a `Req.url`, porque ChatGPT usa `servers[0].url` para llamar las
  acciones. Para ChatGPT Actions, si OAuth queda cacheado o no dispara
  llamadas, usar `/openapi-key.json` con autenticacion `apiKey` por
  header `X-Semaplan-AI-Token`; el gateway valida ese token contra
  `tokens_ia_usuario` y conserva los mismos scopes B2.
  Para respetar el máximo de 30 operaciones de ChatGPT Actions,
  `/openapi-key.json` omite deliberadamente las rutas internas
  `/salud`, `/openapi.json` y `/openapi-key.json`. El contrato conserva
  todas las lecturas y mutaciones operativas de Semaplan.
  `/planes/periodos` lista periodos de tipo `Anio`, `Semestre`,
  `Trimestre` o `Mes`; al recibir `periodo_id` devuelve el arbol
  completo con descripciones, metadatos, estadisticas y registros.
  Las mutaciones del arbol usan IDs estables y el scope historico
  `write_metas`, que ahora cubre Planes; los borrados requieren
  `confirmar_eliminacion: true` y preservan historiales cuando hace
  falta. Al reprogramar una tarea vinculada, el gateway la desvincula
  de su slot o evento anterior y la planifica en el nuevo horario,
  conservando la consistencia de agenda y planes.
  La edición B2 se aplica a cualquier estado de tarea: pendiente,
  completada, pospuesta o cancelada. Si no recibe `estado`, conserva el
  valor existente y, por lo tanto, también conserva la fecha de
  completado de una tarea hecha.
  Para la conversación también publica `/buscar` (búsqueda transversal),
  `/resumen` (día o semana), `/diagnostico/planes` y `/historial`.
  `/buscar` incluye Decoteca: con `modulo=decoteca` busca una obra o
  lista una teca y devuelve su ficha, metadatos, partes, datos de la
  teca y registros de avance. Nunca expone `Portada_Data_Url` en la
  lectura remota.
  Las tareas incluyen sus vínculos operativos en esas vistas, para que
  el chat explique el impacto antes de cambiar datos. `POST /b2/lote`
  entrega primero una previsualización y solo aplica al recibir
  `confirmar_aplicacion: true`; admite hasta 50 acciones B2 sobre
  Tareas, Hábitos, Planes, Archivero, Baúl y Decoteca dentro de una
  transacción
  atómica. Cada elemento de `operaciones` declara una acción B2 y su
  payload original, por lo que el chat puede combinar módulos sin
  encadenar llamadas individuales. Las fechas de tareas pueden usar
  `fecha_relativa` (`hoy`, `mañana`, `pasado mañana`, próximo día de
  semana o `en N días`). `POST /b2/deshacer` repone el estado previo de
  la última mutación del chat —o una indicada por ID— tras una
  confirmación explícita y con el scope original.
  Decoteca usa el scope específico `write_decoteca`. Para no inutilizar
  los tokens B2 emitidos antes de esta capacidad, el gateway acepta de
  forma compatible `write_metas`; los tokens nuevos deben recibir
  `read` y `write_decoteca`. Las carátulas que llega a guardar el GPT
  son URL públicas directas: la búsqueda de fuentes se hace con Web
  Search de ChatGPT y la Action no descarga ni persiste archivos de
  imagen externos.
- `supabase/functions/semaplan-ai-mcp`: servidor MCP remoto por HTTP
  (streamable compatible) para ChatGPT Apps/Developer Mode. Expone
  `initialize`, `tools/list` y `tools/call` en el endpoint
  `/functions/v1/semaplan-ai-mcp/mcp`, incluyendo `search` y `fetch`
  para compatibilidad de conectores/deep research en ChatGPT. Reenvia
  tools de lectura al gateway `semaplan-ai` reutilizando
  `Authorization` OAuth o `X-Semaplan-AI-Token`.
- `supabase/functions/semaplan-telegram`: webhook de escritura acotada
  para bot de Telegram. Opera tareas, habitos, avances de Metas,
  avances de Decoteca y consulta de pendientes. Valida secreto de
  webhook, exige vinculo previo en `telegram_vinculos_usuario`,
  registra comandos en `telegram_comandos_usuario` para auditoria e
  idempotencia, usa confirmaciones persistidas para borrados y guarda
  `estado_usuario` con control de `version`.
- `Herramientas/Scripts/semaplan-ai-mcp-server.js`: puente MCP local
  por `stdio` que expone herramientas para Claude y las reenvia al
  gateway `semaplan-ai`, sin leer Supabase directo.
- `Aplicaciones/Desktop/Melomania`: app Electron personal para la
  meta musical `Melomania`. Conecta con Semaplan usando Supabase Auth
  de produccion, lee `Planes_Periodo`, lista albumes cargados como
  subobjetivos del objetivo `Melomania`, permite crear ese objetivo
  base si no existe y fija o borra la metrica `Puntuacion` del album
  dentro de los metadatos del subobjetivo. Spotify se conecta por
  OAuth PKCE con `playlist-modify-private`, `playlist-read-private` y
  `user-read-private`; abre el navegador externo y recibe el retorno
  en `/spotify/callback` del servidor local del `.exe`, evitando usar
  `file://` como redirect. Busca albumes, crea una playlist privada
  por album y guarda el subobjetivo con partes por cancion; si
  `Melomania` todavia no existe, la crea automaticamente al guardar el
  primer album. last.fm se conecta con API key y usuario, consulta
  conteos publicos por tema y marca partes/albumes como realizados
  cuando cada cancion llega al umbral elegido, sin persistir
  `Escuchas_Lastfm` en Semaplan.
- `supabase/functions/*`: Edge Functions remotas para suscripcion,
  ayuda, eliminar cuenta y demas integraciones.
- `supabase/migrations/*`: cambios de esquema remoto.

## Panorama general

Semaplan es una app de planificacion personal con varios sistemas que
comparten un mismo blob de estado.

Los modulos principales son estos.

- Calendario y agenda semanal.
- Objetivos de sidebar y eventos asociados.
- Slots vacios, tipos de slot y planes de slot.
- Tareas sueltas por fecha o cajon.
- Habitos con programacion y registros.
- Retos de varios dias vinculados a uno o mas habitos.
- Archivero para notas, etiquetas y adjuntos.
- Baul como backlog de objetivos e ideas accionables.
- Decoteca como archivo cultural persistido por tecas.
- Nutrifit como calculador de comidas, base de alimentos, registro diario
  y plan semanal opcional.
- Metas resumidas por fuente.
- Planes semanales.
- Planes por periodos con objetivos, subobjetivos y partes.
- Configuracion, backups, import/export y sync remoto.

## Estado persistido

La app construye el blob completo en `Construir_Estado_Completo()`.

Las claves centrales persistidas hoy son estas.

- `Objetivos`
- `Eventos`
- `Metas`
- `Slots_Muertos`
- `Planes_Slot`
- `Planes_Semana`
- `Planes_Periodo`
- `Plantillas_Subobjetivos`
- `Categorias`
- `Etiquetas`
- `Baul_Objetivos`
- `Decoteca`
- `Nutrifit`
- `Archiveros`
- `Notas_Archivero`
- `Etiquetas_Archivero`
- `Patrones`
- `Habitos`
- `Habitos_Registros`
- `Retos`
- `Tareas`
- `Tareas_Cajones_Definidos`
- `Config_Extra`
- `Sync_Datos_Marca_Ms`
- `Tipos_Slot`
- `Slots_Muertos_Tipos`
- `Slots_Muertos_Nombres`
- `Slots_Muertos_Titulos_Visibles`
- `Slots_Muertos_Nombres_Auto`
- `Slots_Muertos_Grupo_Ids`
- `Semanas_Con_Defaults`

La Decoteca persiste en la clave raiz `Decoteca`. Su formato canonico
tiene `Tecas`, `Obras`, `Listas_Personalizadas` y `Avances`.
Las listas personales pertenecen a una teca, contienen IDs de obras y
conservan un orden manual independiente; una misma obra puede estar en
varias listas. `Normalizar_Decoteca()` completa
las tecas de sistema, normaliza obras viejas que usen `Teca` en lugar
de `Teca_Id`, migra partes simples a `Partes` estructuradas, y conserva
estados vacios ya inicializados para import/export y sync.

La carga local/restauracion pasa por `Cargar_Estado()` y luego por
`Normalizar_Estado()`.

## Carga, guardado y sync

El flujo operativo base es este.

1. `Inicializar_Supabase()` crea el cliente remoto.
2. Al entrar, la app aisla el cache por usuario. Si hay una copia local
   pendiente, la conserva hasta poder compararla con remoto; si la
   consulta remota falla, no borra el pendiente ni reemplaza ese cache.
   Sin pendiente local, carga remoto mediante
   `Backend_Cargar_Estado_Remoto()`.
3. `Normalizar_Estado()` deja todos los modulos en formato canonico.
4. Los renders principales reconstruyen UI segun el estado ya
   normalizado.
5. `Guardar_Estado()` construye y serializa una sola vez el estado
   completo. Antes de escribir el blob marca en memoria y en storage que
   existe sync pendiente; luego `Persistir_Estado_Local_Seguro()` escribe
   estado, usuario y marca pendiente, y verifica la lectura resultante.
   Solo programa sync remoto si cambiaron datos reales. Las sesiones y
   otras marcas operativas no ensucian datos del usuario.
5.b Si falta cuota local, la persistencia reduce primero los backups
   automaticos y luego los manuales mediante candidatos conservadores,
   y reintenta la misma escritura. Si tampoco asi puede verificarla,
   registra el error y muestra una unica advertencia de riesgo de perdida;
   este es un fallo local excepcional, no un estado normal de sync.
6. `Backend_Sync_Programar()` mantiene una sola cola silenciosa: usa un
   debounce corto de 200 ms para cambios normales y prioridad inmediata
   para cambios criticos. No hay indicador `Guardando`, `Pendiente` o
   `Error`, ni reintento manual visible.
6.b Las mutaciones visibles del calendario que crean, mueven,
   redimensionan, repiten, limpian, pegan o tildan bloques, y las que
   crean, borran, limpian o planifican slots muertos/vacios, usan
   `Guardar_Estado_Cambio_Critico()` para no quedar atadas al debounce
   normal y evitar perder los ultimos cambios al reloguear.
7. `Backend_Sync_Ejecutar()` sube el estado a `estado_usuario` mediante
   `aplicar_estado_usuario_web`, la unica RPC habilitada para escrituras del
   frontend. La RPC exige la version remota esperada y la version del cliente,
   y devuelve la nueva version confirmada. Las politicas RLS no permiten
   `INSERT` ni `UPDATE` directos desde clientes web, por lo que una version
   vieja no puede aplicar ni siquiera el primer lote de un snapshot obsoleto.
   Esas versiones tambien quedan marcadas como `deprecated` y deshabilitadas
   en el selector de Configuracion, aun si comparten el esquema de datos.
7.a Cada dispositivo conserva en IndexedDB la ultima base remota confirmada.
   Si una escritura pierde la carrera de version, el cliente relee remoto y
   hace un rebase de tres vias entre base, estado local y estado remoto. Los
   cambios independientes se combinan de forma recursiva; los arrays de
   entidades con `Id` se combinan por entidad y los borrados solo se aplican
   cuando la contraparte no edito esa misma entidad.
7.b Al iniciar con un pendiente local, el mismo rebase se ejecuta antes de
   renderizar. En conflictos sobre el mismo campo prevalece remoto para que un
   cache viejo no degrade configuraciones nuevas. Si no existe base persistida,
   se crea un backup de recuperacion y se adopta remoto sin inferir cambios.
   Durante una sesion activa, un conflicto sobre el mismo campo conserva la
   edicion local actual, pero nunca descarta altas o ediciones remotas vecinas.
7.c Despues de un sync exitoso, la foto remota interna se guarda como
   clon JSON limpio, no como referencia compartida con los arrays vivos
   de la app. Esto evita que mutaciones in-place posteriores de
   habitos, notas, slots, planes u otros modulos contaminen la referencia
   remota y queden invisibles para el diff de guardado.
7.d Cada guardado de datos captura la revision local y el contenido que
   efectivamente envio. El exito remoto limpia el pendiente solo si ambos
   siguen coincidiendo con el estado local. Si aparece otro cambio durante
   la consulta, conserva el pendiente y programa el siguiente ciclo. La
   comparacion normaliza el orden de propiedades JSON para que estados
   equivalentes no generen reintentos.
7.e Los guardados de metadata operativa, como heartbeat o cortes de sesion,
   no confirman ni limpian cambios de datos del usuario.
7.f El `keepalive` de cierre usa la misma RPC. Solo limpia el pendiente si el
   servidor devuelve una fila con version nueva; una respuesta vacia por
   conflicto conserva el pendiente para el proximo arranque.
8. Al iniciar una sesion logueada, la app lee remoto antes de entrar y
   registra una unica `Sesiones_Operativas` activa como lease
   exclusivo. Si detecta otra sesion reciente del mismo usuario,
   bloquea la entrada y ofrece cerrar las demas sesiones o salir.
9. El lease operativo se renueva con heartbeat remoto liviano. Si el
   usuario elige cerrar las demas sesiones, la app escribe un corte en
   `Sesiones_Operativas`, conserva solo la sesion actual y las otras
   quedan expulsadas cuando revisen remoto. El corte usa una generacion
   unica aceptada por la instancia actual: no depende de que los relojes
   de dos computadoras coincidan. Como segunda barrera, Supabase invalida
   los tokens de renovacion de las demas sesiones sin cerrar la actual.
   Para clientes 1.8.0, tambien conserva un corte horario mayor que el
   inicio declarado por cualquier lease remoto, aunque el reloj de ese
   dispositivo este adelantado.
   Si una app se cierra o se cae sin liberar el lease, la sesion vence
   por TTL. El heartbeat y los cortes de sesion suben solo metadata
   operativa de sesion, no el blob completo del usuario, para evitar
   timeouts en cuentas grandes.
9.a Cada instancia web o Desktop revisa el corte operativo cada 5
   segundos con una lectura liviana. Esta revision sigue activa cuando
   Electron queda minimizado; el heartbeat de 30 segundos permanece como
   respaldo. Al salir se detienen ambos temporizadores y se limpia la
   identidad operativa local para que un ingreso posterior sea nuevo.
9.b `Sesiones_Operativas` es metadata operativa: no forma parte del
   estado normal generado por `Construir_Estado_Completo()` y no debe
   contarse como cambio de datos del usuario.
10. `Sync_Datos_Marca_Ms` marca cambios reales de datos generados por
    `Guardar_Estado()`. La metadata de sesiones no actualiza esa marca.
11. La resolucion entre dispositivos no usa `Date.now()` ni compara relojes
    locales para autorizar sobrescrituras. `version` define la carrera remota y
    la base persistida define que cambio realmente hizo cada dispositivo.
11.b Un pendiente legado sin base demostrable se guarda como backup de
    recuperacion y no se sube automaticamente sobre un remoto existente.
12. La metadata operativa de sesiones (`Sesiones_Operativas` y
   `Sesion_Global_Corte_Ms`) no se trata como cambio de datos del
   usuario. Si el remoto cambio solo por metadata operativa, no se muestra
   conflicto ni toast de otro dispositivo. Si la RPC versionada pierde una
   carrera, `Backend_Sync_Ejecutar()` relee la fila, combina los cambios contra
   la base confirmada y reintenta sobre la nueva version.
13. El unico polling remoto permanente fuera del heartbeat es la lectura
    liviana del corte de sesiones cada 5 segundos; no carga ni aplica el
    estado normal del usuario. Los cambios de datos se revisan al volver
    al foco/visibilidad o por eventos locales de sync. Cuando vuelve la
    conexion, el evento `online` adelanta la cola local pendiente.
14. `Hay_Sync_Pendiente()` representa trabajo real pendiente
    (timer, reintento, promesa o escritura en curso). Es una señal interna
    y no un texto visible.
14.b Los reintentos automaticos no tienen estado terminal: continúan
    mientras existan datos locales sucios. El backoff satura en 5 minutos
    con demoras de 2, 5, 15, 60 y 300 segundos, y se adelanta al volver
    la conexion, el foco o la visibilidad.
14.c Cada lectura o escritura principal tiene cancelacion local a los
    45 segundos. Un timeout local o del backend conserva los datos
    pendientes y entra en el mismo ciclo de reintento silencioso, sin una
    segunda lectura diagnostica que duplique la espera.
14.d Cuando hay muchos cambios acumulados, el sync versionado envia el
    estado en lotes por claves raiz para evitar timeouts por payload
    grande. Cada lote actualiza la misma fila con control de version y el
    pendiente se limpia solo al terminar el ultimo lote sin cambios
    locales posteriores.
15. `Cerrar sesion en todas` registra primero un corte global propio en
   el estado remoto. Si Supabase rechaza el `signOut` global, la app
   registra el error pero igualmente cierra la sesion local, porque el
   corte remoto propio es el mecanismo que expulsa a las otras
   sesiones al revisar sync. Si el corte propio falla (por ejemplo por
   timeout) pero `signOut` global responde, tambien se cierra la sesion
   local sin mostrar falso error de cambios sin guardar.
16. Si `Cerrar sesion en todas` encuentra sync local pendiente, fuerza
   el corte global usando el estado local actual como base remota. Si
   hay un conflicto pendiente, interrumpe el cierre y muestra el
   conflicto para que el usuario lo resuelva antes de expulsar otras
   sesiones.
17. Antes de salir, la app drena ciclos consecutivos de sync dentro de
   un limite acotado. Un ciclo exitoso no habilita la salida si durante
   ese mismo ciclo aparecio una revision local posterior.

Funciones transversales importantes.

- `Construir_Estado_Completo()`
- `Cargar_Estado()`
- `Normalizar_Estado()`
- `Guardar_Estado()`
- `Guardar_Estado_Cambio_Critico()`
- `Backend_Sync_Programar()`
- `Backend_Sync_Ejecutar()`
- `Preparar_Sesion_Operativa_Entrada()`
- `Revisar_Corte_Sesion_Operativa_Remoto()`
- `Invalidar_Otras_Sesiones_Auth()`
- `Backend_Registrar_Corte_Sesion_Global()`
- `Backend_Forzar_Corte_Global_Desde_Local()`
- `Invocar_Edge_Con_Sesion()`
- `Aplicar_Importacion_Objeto()`

## Calendario y objetivos

El calendario semanal sigue siendo el eje visual principal.

Objetos centrales.

- `Objetivos`: objetivos del sistema tradicional ligados al sidebar y
  a eventos.
- `Eventos`: bloques del calendario.
- `Semana_Actual`: semana visible.

Funciones utiles para entrar a este subsistema.

- `Render_Calendario()`
- `Render_Eventos()`
- `Render_Editor()`
- `Render_Resumen_Semanal()`

Notas operativas.

- Muchos flujos vecinos terminan impactando eventos aunque se disparen
  desde tareas, slots, habitos o planes.
- Si se toca creacion, edicion, borrado o movimiento de eventos hay
  que revisar efectos colaterales en planes semanales, planes de slot,
  metas y sync.
- Al copiar o mover bloques entre semanas, el `Objetivo_Id` del evento
  se remapea a la instancia semanal de destino (misma familia/plantilla
  cuando existe, o override semanal si falta). Ese remapeo debe gatillar
  recalculo de vinculos a habitos y redistribucion de aportes de metas
  para que el computo quede en la semana nueva y no en la de origen.
- La duracion por defecto de eventos define tambien el paso visible de
  la grilla del calendario. Solo se permiten 15 minutos, 30 minutos y
  1 hora. Al cambiarla, `Duracion_Grilla_Eventos` permite detectar el
  paso anterior y migrar eventos, slots muertos y `Planes_Slot`: al
  partir una hora los items generales van al primer sub-bloque y las
  tareas con hora van al sub-bloque correspondiente; al fusionar
  sub-bloques se unifican items y notas sin generar copias duplicadas.
- Los selectores de franjas de patrones y de slots muertos por defecto
  deben usar el mismo paso visible de la grilla. Con grilla de 15
  minutos tienen que ofrecer 21:00, 21:15, 21:30 y 21:45, sin truncar
  los valores decimales al guardar.
- Al aplicar una franja bloqueada de patron o de slots muertos por
  defecto, todos los sub-slots generados por esa franja comparten
  `Slots_Muertos_Grupo_Ids` para que se vean y operen como una franja
  continua al repetir, redimensionar o arrastrar.
- En migracion a grilla mas fina (1h -> 30m/15m), los bloques no se
  fragmentan en copias hijas y los slots muertos tampoco se duplican:
  se conserva solo el primer bloque/slot resultante para evitar
  multiplicaciones artificiales en calendario y planes.
- El resumen accesible desde el calendario ya no esta limitado a la
  semana visible: permite leer semana, quincena, mes, ano o rango
  personalizado. Sus pestanas de objetivos, dias y metas comparten el
  mismo rango de lectura.
- La pestana Metas del resumen es de solo lectura y cruza el rango
  seleccionado contra `Planes_Periodo`, mostrando avance dentro del
  rango y acumulado actual de objetivos, subobjetivos y partes.
- En Resumen > Metas las tarjetas son compactas y expandibles. La barra
  y el porcentaje usan unidades avanzadas del rango contra el valor
  objetivo contextual de ese periodo; el detalle muestra primero
  subobjetivos y partes con avance, ordenados de mayor a menor, y deja
  los items sin avance detras de botones de expansion.
- En Resumen > Metas un objetivo solo se incluye si tuvo avance dentro
  del rango visible, si su target contextual para ese rango es mayor a
  cero o si su periodo solapa el rango y tiene target total definido.
  Si no tiene meta ni avance en el rango, queda oculto; si tiene avance
  pero no meta, se muestra como 100%.
- Si la vista visible estaba siguiendo el dia actual con el filtro
  automatico o manual de solo hoy, el refresco automatico por cambio de
  fecha tambien reubica la semana visible. Al pasar de domingo a lunes,
  la vista queda en el lunes de la nueva semana y no en el domingo de la
  semana anterior.
- La seleccion multiple de objetivos semanales conserva los ids
  seleccionados mientras se abre el dialogo de cambio de categoria.
  La categoria se aplica en lote al confirmar y recien despues se
  limpia la seleccion.

## Slots vacios, bloques y planes de slot

Este subsistema modela disponibilidad y planificacion liviana dentro de
franjas horarias.

Objetos centrales.

- `Slots_Muertos`
- `Tipos_Slot`
- `Planes_Slot`
- `Slots_Muertos_Tipos`
- `Slots_Muertos_Nombres`
- `Slots_Muertos_Titulos_Visibles`

Funciones de entrada recomendadas.

- `Normalizar_Slots_Muertos()`
- `Normalizar_Planes_Slot()`
- `Render_Config_Tipos_Slot()`
- `Render_Config_Slots_Muertos()`
- `Render_Modal_Plan_Slot()`
- `Render_Fila_Plan_Slot()`

Relaciones importantes.

- Un slot puede tener metadata propia y a la vez items planeados.
- Si un slot deja de ser vacio y aparece un evento real, parte del
  plan de slot puede transferirse al evento.
- Los patrones de tipo slot alimentan este sistema.
- En pedidos de reforma de `Planes` de bloques, el alcance operativo
  por defecto incluye bloques, slots muertos y slots vacios, salvo que
  el usuario aclare otra cosa.
- En el modal de plan de slot o bloque, los habitos sugeridos ya no se
  muestran en un apartado separado: aparecen primero dentro del
  desplegable de habitos y el selector se pinta en gris cuando contiene
  sugerencias. Los habitos diarios se sugieren solo cuando coinciden
  con el dia y la hora del slot. Los habitos semanales, quincenales y
  mensuales pendientes se sugieren dentro del periodo aunque su
  programacion tenga dias u horarios preferidos; dejan de aparecer
  cuando el periodo queda completo. La lista sugerida se ordena por
  periodo: diarios, semanales, quincenales y mensuales; y dentro de
  cada periodo por tipo: Check, Cantidad, Tiempo y Evitar.
- Los planes de slots vacios, slots muertos y bloques usan controles
  desplegables equivalentes para agregar habitos y tareas, no objetivos
  semanales. En el desplegable de tareas van primero las tareas del
  mismo dia y horario, despues las tareas sin horario y al final las de
  otros horarios. Las tareas agregadas se guardan como items con
  `Tarea_Id`, se deduplican por ese identificador y conservan el
  vinculo al persistir o transferirse entre plan de slot y bloque.

## Tareas

Las tareas son entidades propias, separadas de `Objetivos`.

Objetos centrales.

- `Tareas`
- `Tareas_Cajones_Definidos`

Modelo basico de tarea normalizada.

- `Id`
- `Nombre`
- `Emoji`
- `Cajon`
- `Prioridad`
- `Estado`
- `Fecha`
- `Hora`
- `Planeada`
- `Evento_Id`
- `Abordaje_Id`
- `Plan_Clave`
- `Plan_Item_Id`
- `Descripcion`, `Etiquetas`, `Fecha_Limite` y `Repeticion`
- `Subtareas`, `Adjuntos`, `Dependencias_Ids` y tiempos estimado/real
- `Motivo_Posposicion`, `Fecha_Sugerida`, `Archivada` e `Historial`

Funciones de entrada recomendadas.

- `Normalizar_Tarea()`
- `Normalizar_Tareas()`
- `Render_Tareas()`
- `Render_Tareas_Panel()`
- `Render_Tareas_Editor()`
- `Render_Tareas_Cajones()`

Relaciones importantes.

- Una tarea puede existir sin evento.
- Una tarea puede quedar planeada y vinculada a un slot, evento o
  abordaje.
- Cambios en tareas pueden impactar agenda, planes de slot y sync
  critico.
- La busqueda del panel de Tareas filtra sobre la vista visible actual,
  no sobre toda la base. Debe matchear de forma normalizada por nombre,
  cajon, prioridad, estado, fecha y hora, y mostrar `Sin resultados`
  cuando la vista sigue existiendo pero la busqueda no devuelve items.
- Cuando el panel de Tareas tiene busqueda o filtros activos, debe
  mostrar un resumen visible en chips y una accion `Limpiar` que
  restablezca el modo base de la vista actual, sin forzar vuelta a
  `Inbox` si el usuario estaba mirando otra pestaña.
- Crear y editar tarea deben tomar el cajon desde un selector real
  alimentado por `Tareas_Cajones_Definidos`, para que un cajon nuevo
  quede disponible enseguida como opcion visible y no dependa de
  sugerencias implicitas del navegador.
- Las tareas archivadas se conservan con su historial y no se eliminan
  por la accion habitual del modulo. Las dependencias pendientes marcan
  la tarea como bloqueada e impiden completarla hasta resolverlas.
- En la vista diaria, los habitos no programados siguen visibles con el
  estado `No corresponde hoy`; permiten un registro manual cuando el
  usuario los realiza, pero ese registro queda fuera de la programacion
  y no altera la racha ni el cumplimiento programado.

## Habitos

Los habitos tienen definicion, programacion y registros historicos.

Objetos centrales.

- `Habitos`
- `Habitos_Registros`
- `Patrones`

Modelo basico de habito normalizado.

- `Id`
- `Nombre`
- `Emoji`
- `Color`
- `Activo`
- `Archivado`
- `Fecha_Inicio`
- `Tipo`
- `Programacion`
- `Meta`
- `Meta_Historial`

`Programacion` conserva compatibilidad con los hábitos viejos y puede
usar un ciclo personalizado. En ese caso guarda `Tipo_Ciclo: "Ciclo"`,
`Semanas_Ciclo`, `Dias_Ciclo` y `Fecha_Ancla`; cada posición del ciclo
contiene los días aplicables de esa semana. La fecha de ancla define la
primera posición y los días no aplicables no se muestran como pendientes,
no rompen rachas y no reducen porcentajes.

Funciones de entrada recomendadas.

- `Normalizar_Habito()`
- `Normalizar_Habitos()`
- `Normalizar_Habito_Registro()`
- `Render_Modal_Habitos()`
- `Render_Habitos_Panel()`
- `Render_Habitos_Registro()`
- `Render_Habitos_Notas()`
- `Render_Modal_Habito_Editor()`
- `Render_Habitos_Sidebar()`

Relaciones importantes.

- Los habitos pueden vincularse a objetivos, subobjetivos, partes,
  items de patron y slots.
- Un objetivo de `Planes_Periodo` puede tener un vínculo operativo de
  ritmo con `Rol: "Ritmo_Meta"`. Ese hábito no crea una segunda meta ni
  una segunda fuente de progreso: define la acción, el período de
  evaluación y los días válidos. Al comenzar una jornada activa se fija
  una pauta en `Ritmo_Diario_Historial`; el progreso del día cambia lo
  que falta hoy, pero no reescribe esa pauta. La siguiente jornada
  activa vuelve a distribuir el pool pendiente actualizado.
- En un hábito diario de ritmo, el indicador conserva la pauta fijada
  como denominador aunque el avance la supere: `55/50`, no `55/55`.
- Cada hábito con rol `Ritmo_Meta` tiene una sola meta propietaria. Si
  se reasocia, la app quita la asociación operativa anterior sin tocar
  los demás vínculos ordinarios de esa meta.
- El ritmo asociado admite programación semanal, días puntuales del mes,
  ciclos de días y ciclos de varias semanas. `Fechas_Activas` y
  `Fechas_Inactivas` permiten excepciones puntuales; una exclusión tiene
  prioridad sobre una inclusión y ambas tienen prioridad sobre el patrón
  recurrente. La meta del hábito puede operar por día, semana, quincena
  o mes; el valor actual se calcula sobre los días válidos restantes.
- Los registros del hábito asociado se reconstruyen desde avances de
  Planes con fuente `Plan_Objetivo_Ritmo`. Registrar desde la tarjeta o
  la sidebar del hábito abre el avance de la meta y nunca agrega un
  registro manual paralelo. Así, editar o borrar el avance en Planes
  conserva una sola fuente de verdad.
- Cambios en programacion o registros pueden alterar sidebar,
  indicadores, planes y enfoque diario.
- El modal principal de Habitos se cierra con Escape igual que los
  submodales internos, para mantener consistencia con el resto de la UI.
- Los vinculos de habitos en bloques/eventos muestran una ayuda breve
  sobre como se computan las cantidades realizadas por bloque tildado.
- Cuando una parte o subobjetivo se marca como realizado o se cancela
  esa realizacion, la UI de habitos debe refrescar sidebar y modal
  desde `Habitos_Registros` en el mismo flujo para reflejar color,
  estado e indicador sin esperar un render posterior.
- Si el usuario filtra por estado `Realizado` en el panel de Habitos,
  la UI no debe dejar activo al mismo tiempo `Ocultar realizados`,
  porque eso genera un filtro contradictorio y una lista vacia falsa.
- Al normalizar `Habitos_Registros`, si falta `Periodo_Clave` debe
  reconstruirse desde el habito y la fecha para no perder registros
  diarios, semanales o mensuales viejos. En quincena, la clave se sigue
  recalculando para sostener la migracion vigente.
- `Meta_Historial` conserva cambios con `Desde` y una copia de `Meta`;
  el final de cada período se deriva de la fecha del cambio siguiente y
  no se persiste como `Hasta`. El estado, el límite y las estadísticas
  resuelven la meta correspondiente a cada fecha, incluso si ese día no
  tiene registros. Mientras no haya cambios, `Meta` es editable y aplica
  a todas las fechas. Al modificarla por primera vez, la UI pregunta si
  se aplica a todas las fechas o desde hoy en adelante; esta segunda
  opción crea el período anterior y el nuevo cambio. Con cambios
  existentes, `Meta` queda bloqueada y el apartado `Cambios` permite
  editar la fecha y el valor de cada ítem o borrar cambios. Al borrar el
  último cambio, `Meta` vuelve a ser editable. Cada registro nuevo
  también conserva `En_Programacion` y `Meta_Cantidad` como contexto
  histórico de compatibilidad. Los registros viejos sin `Meta_Cantidad`
  siguen cubiertos por `Meta_Historial` después de normalizar el hábito.
  Las estadísticas siguen aplicando la programación actual de forma
  retroactiva al rango consultado: un avance fuera de un día válido se
  mantiene visible, pero no suma meta, cumplimiento, promedio ni
  proyección.
- Cuando el panel de Habitos tiene filtros activos, debe exponer ese
  estado en chips visibles y ofrecer `Limpiar` en el mismo bloque para
  volver rapido al panel completo sin dejar filtros silenciosos.
- Cada registro de hábito puede conservar una `Nota` opcional asociada
  a su fecha, cantidad y procedencia. El registro manual desde el panel
  o la sidebar ofrece agregar esa nota sin obligarla; el visor de Notas
  permite consultar y editar las notas históricas por hábito.
- La tarjeta expandida conserva Racha, Éxitos y Registro. Promedio y
  Vínculos no se muestran; Estadísticas abre un modal con período,
  agrupación por día/semana/mes, cumplimiento, total, racha y barras
  adaptadas a hábitos de check o de cantidad. Al agrupar por día, cada
  fecha incluye debajo el día de la semana; el scroll se separa de esos
  rótulos y usa una pista transparente. En semana y mes, la meta y el
  progreso que determinan cumplimiento, color y promedio acumulan sólo
  los días válidos del hábito; los avances fuera de programación siguen
  incluidos en el total mostrado. La leyenda informa el promedio del
  agrupamiento y proyecta ese ritmo a un año de 365 días. Debajo, una
  segunda línea de `Avance` compara todas las unidades realizadas del
  rango contra la meta total programada, con unidad y porcentaje. El
  selector de período conserva rangos móviles y suma `Semana actual`
  (lunes a domingo) y los últimos doce meses calendario. En la semana
  actual y el mes actual, el gráfico conserva los días futuros como
  barras nulas, mientras que promedio, proyección y racha se calculan
  solamente hasta el día actual.
- Cada barra del gráfico es interactiva. Al seleccionarla se abre un
  detalle del día, semana o mes correspondiente que suma los registros
  y los agrupa por nombre visible de origen, aunque provengan de IDs
  técnicos distintos. Cada grupo muestra el emoji del hábito y se puede
  expandir para consultar los registros individuales con fecha, hora,
  cantidad y nota cuando exista.
- Al cambiar la vista temporal de Hábitos o Tareas, la fecha de
  navegación se restablece a la fecha actual para evitar quedar anclado
  en un día viejo.

## Nutrifit

Nutrifit es un módulo de alimentación opcional, independiente de la
agenda. No consulta Internet ni pretende reemplazar asesoramiento
profesional: calcula únicamente a partir de la base local de alimentos.

Estado actual.

- El estado raíz `Nutrifit` contiene `Categorias`, `Alimentos`, `Comidas`,
  `Recetas`, `Planes_Semanales`, `Objetivos`, `Favoritos` y `Recientes`.
- Cada alimento define una unidad base (`g`, `ml`, `unidad` o `porción`),
  una cantidad de referencia, calorías, proteína y, opcionalmente,
  carbohidratos, grasas, fibra, azúcares y sodio. También admite marca,
  estado, descripción de porción, código de barras, fuente y medidas
  domésticas configurables. Las comidas y recetas guardan instantáneas,
  por lo que editar la base no altera el historial.
- El calculador admite cantidades cero y decimales, conversiones entre g/kg
  y ml/l, porciones, unidades y medidas domésticas. Rechaza valores
  negativos, alimentos inexistentes y unidades incompatibles. La carga
  rápida acepta líneas como `fideos 400 g` o `faina 1 porción`.
- La base se puede importar desde texto CSV/TSV con previsualización,
  conservar o actualizar alimentos existentes y exportar nuevamente a CSV.
  El módulo no consulta Internet ni completa automáticamente datos sin una
  fuente declarada.
- `Anotar en el registro` muestra una confirmación explícita y permite
  elegir fecha, momento del día, hora y nota. El registro permite editar,
  reutilizar y borrar comidas, navegar por fecha, filtrar por rango,
  copiar el día anterior y consultar totales, promedios y cantidad de días
  registrados. Al borrar una comida se limpian sus referencias en los
  planes semanales.
- Las recetas permiten indicar rendimiento en porciones, calcular valores
  por porción, reutilizar una receta en el calculador y borrarla.
- El plan semanal es opcional y permite cinco momentos por día: desayuno,
  almuerzo, merienda, cena y colación. Muestra calorías y proteína
  estimadas y separa el estado de cada métrica en `Dentro`, `Debajo`,
  `Encima` o `Sin objetivo`; no diagnostica déficit calórico.
- La información metodológica breve se conserva en la fuente del alimento,
  los metadatos y los avisos visibles del módulo.
- El botón `Nutrifit_Boton` y el modal `Nutrifit_Overlay` respetan la
  visibilidad configurable del menú y las traducciones es/en/pt.
- Desde la versión de frontend `1.13.0`, el esquema de estado es `11`.
  Las versiones anteriores se mantienen fuera del selector si no soportan
  esta estructura.
- Desde la versión de frontend `1.14.0`, el esquema de estado es `12`.
  Esta versión incorpora la capa independiente de Semanas en Planes;
  las versiones anteriores se mantienen fuera del selector para evitar
  que interpreten esas semanas como períodos personalizados.
- Desde la versión de frontend `1.15.0`, el esquema de estado es `13`.
  Esta versión agrega el estado persistido de reprogramación de
  subobjetivos y sus ramas de continuidad; las versiones anteriores se
  mantienen fuera del selector para evitar que los muestren como activos.

Funciones principales.

- `Nutrifit_Abrir()`
- `Nutrifit_Cerrar()`
- `Render_Nutrifit()`
- `Nutrifit_Guardar_Alimento()`
- `Nutrifit_Anotar_Calculo()`
- `Nutrifit_Guardar_Receta()`
- `Nutrifit_Render_Registro()`
- `Nutrifit_Importar_Guardar()`
- `Nutrifit_Guardar_Objetivos()`
- `Nutrifit_Actualizar_Plan_Dia()`
- `Normalizar_Nutrifit()`

`Nutrifit` entra en `Construir_Estado_Completo()`, `Cargar_Estado()`,
`Normalizar_Estado()`, sync remoto e import/export como clave raíz.

## Retos

Los retos son compromisos de varios dias que agrupan habitos. No tienen
registros diarios propios: su progreso se calcula desde
`Habitos_Registros` para evitar duplicar fuentes de verdad.

Objetos centrales.

- `Retos`
- `Habitos`
- `Habitos_Registros`

Modelo basico de reto normalizado.

- `Id`
- `Nombre`
- `Emoji`
- `Color`
- `Fecha_Inicio`
- `Duracion_Dias`
- `Estado`
- `Regla_Cumplimiento`
- `Dias_Activos`
- `Habito_Ids`
- `Notas`
- `Fecha_Cierre`
- `Orden`

Funciones de entrada recomendadas.

- `Normalizar_Reto()`
- `Normalizar_Retos()`
- `Abrir_Retos()`
- `Render_Modal_Retos()`
- `Render_Retos_Panel()`
- `Render_Modal_Reto_Editor()`
- `Retos_Estado_Dia()`
- `Retos_Estadisticas()`

Relaciones importantes.

- Un reto puede vincular muchos habitos mediante `Habito_Ids`.
- `Regla_Cumplimiento` define si el dia cuenta cuando se cumplen todos
  los habitos vinculados o cualquiera de ellos.
- `Dias_Activos` guarda los días recurrentes de la semana que computan.
  Los días excluidos se muestran como no computables, no entran en el
  porcentaje ni en la mejor racha y no se consideran fallos.
- Los retos viejos sin `Dias_Activos` se normalizan con los siete dias
  activos para conservar su comportamiento anterior.
- Marcar, destildar o cancelar un habito refresca Retos si el modal
  esta abierto, porque el estado diario se deriva de los registros de
  habitos.
- El total exigido por dia usa solo los habitos vigentes en esa fecha.
  Si se agrega a un reto un habito cuya `Fecha_Inicio` es posterior al
  inicio del reto, los dias previos no quedan marcados como incompletos
  por ese nuevo vinculo.
- Al borrar un habito, se quita su id de los retos vinculados. El reto
  puede quedar sin habitos y se muestra como tal hasta que el usuario lo
  edite o lo borre.
- Crear, editar o borrar retos usa guardado critico porque cambia una
  clave persistida del estado completo.
- El modal principal de Retos se cierra con Escape y refresca su vista
  cuando cambian registros de habitos vinculados.

## Archivero

El Archivero funciona como memoria organizada por cajones.

Objetos centrales.

- `Archiveros`
- `Notas_Archivero`
- `Etiquetas_Archivero`

Funciones de entrada recomendadas.

- `Inicializar_Archiveros_Default()`
- `Normalizar_Texto_Archivero()`
- `Normalizar_Etiquetas_Archivero()`
- `Normalizar_Adjuntos_Archivero()`
- `Render_Archivero()`
- `Render_Archivero_Notas()`
- `Render_Modal_Etiquetas_Archivero()`

Relaciones importantes.

- Las etiquetas usan comparacion normalizada sin depender de acentos.
- Las notas pueden tener texto, origen, color y adjuntos en base64.
- El modal de nota permite editar dia y horario de `Fecha_Creacion`.
  Ese timestamp se normaliza al cargar estado y define la fecha visible
  y el orden cronologico de la nota.
- Hay seleccion multiple, mover entre cajones y gestion de etiquetas.
- Cuando hay busqueda o filtros activos, la cabecera del cajon debe
  mostrar conteo filtrado sobre total en formato `(visibles/total)` y
  el estado vacio debe distinguir `Sin resultados` de `Sin notas`.
- Cuando hay busqueda o filtros activos, el panel de notas tambien debe
  resumirlos en chips visibles y ofrecer `Limpiar` sin mover al usuario
  de cajon ni perder el contexto actual.

## Baul

El Baul es el backlog de objetivos e items accionables no agendados.

Objeto central.

- `Baul_Objetivos`

Funciones de entrada recomendadas.

- `Normalizar_Baul_Objetivo()`
- `Render_Baul()`
- `Render_Detalle_Baul()`
- `Cargar_Objetivo_En_Form_Baul()`

Relaciones importantes.

- Un item del Baul puede tener categoria, etiquetas, estado, timeline,
  descripcion breve, detalle largo y metadatos visibles.
- La descripcion queda como resumen corto para tarjeta y listado; el
  detalle se usa para texto largo, pasos, contexto y notas amplias.
- La accion `Detalle` del menu contextual abre un modal propio de
  texto largo. En modo lectura solo muestra el detalle y un lapiz
  plano junto a la cruz; ese lapiz pasa a edicion del texto, donde
  aparecen solo `Guardar` y `Cancelar`. Esta edicion modifica
  unicamente el campo `Detalle`, sin abrir el editor completo del
  item ni mostrar acciones de agenda o archivado.
- Puede alimentar agenda, objetivos o decisiones semanales.
- La busqueda del Baul debe ser normalizada y de texto completo sobre
  nombre, descripcion breve, detalle, descripcion corta, estado,
  timeline, categoria, etiquetas y metadatos, para evitar que el
  filtro dependa solo del titulo o de los acentos exactos.
- Cuando el Baul tenga busqueda o filtros activos, la interfaz debe
  mostrar un resumen en chips y una accion `Limpiar` robusta aun si el
  campo de busqueda pierde foco y re-renderiza la vista en ese flujo.

## Decoteca

La Decoteca es un archivo cultural persistido por tecas. Toma el
lenguaje frontal del Baul, pero cambia la grilla a tarjetas altas y
angostas tipo caratula.

Estado actual.

- Modelo persistido en `Decoteca`, con `Tecas`, `Obras`,
  `Listas_Personalizadas` y `Avances`. Cada lista personal es propia de
  una teca, admite varias obras y mantiene su orden sin afectar el orden
  general de la teca. Las obras pueden guardar `Partes` estructuradas,
  `Datos_Teca` y
  `Orden` manual persistido por teca para sostener reordenamiento
  propio sin perder filtros ni criterios alternativos.
- Cada obra separa el ciclo de consumo (`Estado`: planeada, en curso,
  terminada o abandonada) de la organizacion de biblioteca
  (`Lista`: Biblioteca, Pausadas o Archivo). Los valores historicos
  `Readlist`, `Proximas` y `Wishlist` se normalizan a la lista vigente
  compatible con el estado de la obra. Tambien guarda `Prioridad`,
  `Motivo`, `Origen` y `Fecha_Ingreso`; el `Rating` se elige desde una
  lista fija (`Pendiente` o valores de 0.5 a 5) para conservar criterio
  historico sin duplicar lista, estado y prioridad.
- `Lista` se conserva solo como compatibilidad interna para datos viejos
  e importaciones legacy. Ya no forma parte de la UX visible de
  filtros, detalle ni edicion de obra.
- Alta y edicion de obras desde la ficha modal de detalle.
- Vista unica `Catalogo` con caratulas verticales para todas las obras
  de la teca. Las obras planeadas o activas se distinguen por `Estado`,
  motivo, origen y fechas dentro del catalogo, sin una pestaña o listas
- El detalle de obra se presenta como ficha modal sobre la Decoteca, con
  fondo oscurecido, caratula lateral, boton superior de edicion con
  icono de lapiz y cierre propio. No se abre por defecto: aparece solo
  al seleccionar una obra y se cierra con el boton de cierre, Escape o
  click en el fondo del modal. Los formularios de obra, teca y caratula
  usan el mismo contenedor modal.
- En el bloque de partes del detalle, cada parte muestra avance sobre
  total cuando existen avance registrado y total de parte, por ejemplo
  `30 de 120 pag.`. Ese dato usa peso normal y el porcentaje queda
  destacado en negrita; si falta avance o total, se muestra solo el
  dato disponible.
- El tooltip de hover de una obra muestra metadatos y avance compacto:
  `Avance` usa solo unidades leidas con porcentaje entre parentesis, y
  `Paginas`/`Total` queda como linea separada. La descripcion no se
  muestra en ese tooltip.
- Click derecho sobre una tarjeta de obra abre un menu contextual con
  `Editar`, `Puntuar`, `Insertar imagen`, `Ver descripcion` y
  `Borrar`. `Ver descripcion` reutiliza el mismo tooltip de la
  tarjeta, reemplaza ahi los metadatos por la descripcion y ya no se
  destruye al sacar el mouse de la caratula: queda abierto hasta
  cerrarlo con la cruz pequeña, con `Escape` o con un click afuera,
  sin activar el detalle lateral. `Insertar imagen` lee el texto actual
  del portapapeles y, si es una URL publica valida, lo guarda directo
  como portada `Url` de la obra sin abrir el editor ni forzar la
  apertura del detalle lateral. `Puntuar` abre un modal liviano con
  valores de 0.5 a 5 para guardar el rating sin entrar a editar la
  ficha. `Editar` y `Borrar` usan los mismos flujos del detalle.
- Edicion de caratula visible de cada obra: icono, texto, color, URL
  publica o archivo de imagen embebido con limite de peso.
- Creacion y edicion de tecas propias con nombre, descripcion, icono,
  color, unidad, subunidad y metrica. Esos campos definen el tipo de
  obra, la estructura interna y la unidad de avance por defecto.
- Borrado de obras con confirmacion. Borrado de tecas propias con
  confirmacion y opcion de mover sus obras a otra teca disponible o
  borrar teca y obras.
- `Bajar metadatos` aparece en la ficha seleccionada y en el alta o
  edicion de obra para Biblioteca, Musicoteca y Videoteca. Busca por
  titulo y creador cuando corresponde, y reemplaza los datos
  descriptivos de la ficha con la fuente elegida: titulo, creador,
  anio, genero, subgenero, descripcion, caratula, `Datos_Teca`,
  `Partes` y metadatos. La fuente queda guardada internamente, pero no
  se muestra como metadato principal en la ficha.
- En Biblioteca, `Bajar metadatos` prioriza un catalogo local de
  estructura de libros cuando esta disponible en
  `Decoteca_Catalogo_Estructura_Libros`,
  `Decoteca_Catalogo_Estructura_Local` o localStorage. Si no hay
  catalogo cargado y el navegador soporta File System Access, el click
  de `Bajar metadatos` permite seleccionar el JSON local; la app no
  intenta leer rutas absolutas de Windows sin permiso. Ese catalogo se
  interpreta como indice con `Libros`, `Biblioteca`, `Obras` o `Items`,
  o como ficha individual de libro con `Titulo`, `Autor`,
  `Numero_Paginas_Total` y `Partes`. Cuando hay indice, se priorizan
  rutas de `Libros/Readlist`, `Libros/Reading` y `Libros/Read`, en ese
  orden; cuando hay una ficha individual sin ruta, se toma como
  candidato unico. El match normaliza mayusculas, acentos, puntuacion
  menor y espacios; si el candidato queda empatado o dudoso, no se
  aplica como local. El autor y el titulo se toman de los campos
  explicitos del catalogo o del nombre de archivo con convencion
  `Autor. Titulo.ext`. Si el JSON trae `Genero`, ese valor reemplaza el
  genero visible de la obra; si no, el genero principal se infiere desde
  subgenero, ubicacion o carpeta.
- Ese catalogo local ahora tambien se intenta cargar automaticamente al
  iniciar Semaplan desde
  `Documentacion/Planes/Lecturas_Json/Decoteca_Catalogo_Estructura_Libros.json`.
  Cuando esta disponible, la app lo usa para migrar las obras de
  Biblioteca que hacen match por titulo y autor, reescribiendo en vivo
  los campos descriptivos correctos sin pasar por `Bajar metadatos`.
- El catalogo local de Biblioteca puede aportar paginas, partes,
  paginas por parte, descripcion y caratula embebida. Cuando hay match
  local, el JSON reemplaza los datos descriptivos existentes de la obra
  en vez de mezclarlos con valores viejos. Si el JSON trae
  `Caratula.Metodo`, `Caratula.Ruta_Imagen` y
  `Caratula.Requiere_Revision`, `Bajar metadatos` guarda esos datos en
  la obra como `Portada_Metodo_Local`, `Portada_Ruta_Local` y
  `Portada_Requiere_Revision`; la ruta se conserva como referencia
  tecnica y no se intenta abrir automaticamente desde el navegador sin
  permiso del usuario. Si no hay match local, recien entonces se usan
  fuentes externas.
  En el editor de caratula hay una accion secundaria para buscar una
  caratula externa sin reemplazar la local hasta que el usuario guarde.
- En libros, Wikidata/Wikipedia se usa para identidad, autoria, anio y
  genero; Open Library aporta paginas, portada y descripcion cuando
  esta disponible; Lectulandia queda como complemento best-effort para
  portada y descripcion.
- Los datos bajados normalizan titulos de obras y partes con formato
  de frase, y autores/artistas/directores con formato de nombre
  propio. Los campos escritos manualmente por el usuario se conservan.
- El boton de registrar avance de Decoteca se muestra solo como icono y
  abre un modal/cartel global de
  registro de avance, separado del panel de detalle y equivalente al
  patron visual usado para registrar avances en Metas/Planes. Puede
  abrirse desde cualquier parte principal de Semaplan, no solo dentro
  de Decoteca. Registra avances propios por teca sin mezclarlos con
  Metas. Permite elegir fecha, cantidad, nota y un item anidado del
  arbol `Teca -> Obra -> Parte`, con `+` y `-` para desplegar ramas.
  El cartel no muestra resumen de periodo; queda limitado al acto de
  registrar avance rapido.
- El boton de registro historico de Decoteca se muestra solo como icono
  y abre el registro de avances en un modal separado. Ese registro tiene
  filtros por anio, teca, obra y parte, y permite editar o borrar
  registros con confirmacion sin mezclar el historial dentro del
  formulario de avance rapido. El resultado filtrado muestra un resumen
  compacto de registros, avance, obras y cierres, y la tabla agrupa
  filas por dia, semana, mes o anio. Cada encabezado de grupo muestra
  periodo, avance acumulado por unidad compatible y cantidad de
  registros, para reconstruir el historial sin convertirlo en tarjetas
  pesadas. En mobile, los filtros del registro se apilan para no
  recortar controles.
- Los filtros de periodo de Decoteca se generan desde fechas de
  planificacion o consumo: `Fecha_Inicio`/`Fecha_Fin` de la obra y
  registros de avance que completan o repiten consumo. El anio de
  publicacion o estreno no se usa como periodo de lectura, escucha o
  visionado.
- El filtro de periodo tiene selector de criterio: `Rango` usa el tramo
  `Fecha_Inicio`-`Fecha_Fin`, `Objetivo` usa solo `Fecha_Fin`,
  `Registros` usa todos los registros de avance y `Final` usa el
  registro de cierre o, para datos viejos sin registros, `Fecha_Fin` de
  obras terminadas. Ademas de los meses y anios detectados, ofrece modo
  `Personalizado` con `Desde` y `Hasta`, admitiendo rangos abiertos o
  cerrados. El selector recalcula las opciones de mes/anio disponibles
  y la grilla respeta esa semantica.
- Cuando el filtro de periodo apunta a un mes o anio concreto, Decoteca
  muestra una franja compacta de resumen debajo de los filtros:
  avance registrado en el rango, obras tocadas, cierres y pendientes.
  La franja respeta busqueda, estado y genero activos, y evita
  mostrar un porcentaje global porque podria mezclar avance de periodo
  con totales completos de obras.
- La barra de filtros suma `Ordenar por` y `Direccion`. `Manual`
  respeta `Obra.Orden`, desactiva la direccion y habilita
  reordenamiento drag and drop persistido dentro de la teca y la vista
  actual. Los otros criterios permiten ordenar por titulo, creador,
  fechas, progreso, total, prioridad, rating, estado, genero,
  formato u origen.
- `Importar` y `Seleccionar` viven dentro de un menu de tres puntos sin
  marco pesado en la barra superior. Ese menu conserva las mismas
  acciones y cierra al clickear afuera, aplicar filtros o presionar
  Escape.
- Decoteca tiene modo `Seleccionar` con barra de acciones masivas para
  obras visibles: cambiar `Estado` o `Prioridad`, agregar o quitar de una
  lista personal, archivar y borrar. Al filtrar una lista personal y usar
  orden manual, el arrastre reordena solo esa lista. Mientras ese modo esta
  activo, el click sobre una obra solo
  alterna seleccion, el detalle no se abre y un click vacio fuera de la
  barra limpia la seleccion sin disparar modales ni menu contextual.
- `Importacion masiva` abre un modal propio. Acepta texto tabular con
  encabezados pegado desde Excel o Google Sheets, y tambien archivos
  CSV, TSV o JSON. El mapeo reconoce columnas como `Titulo`,
  `Autor`/`Artista`/`Director`, `Anio`, `Genero`, `Estado`,
  `Prioridad`, `Total`, `Partes`, `Metadatos` y `Portada`; si aparece
  `Lista`, se toma solo como dato legacy sin volverla visible en la
  ficha. Los archivos `.xlsx`/`.xls` no se parsean directo en frontend:
  la UI pide copiar la tabla o exportarla a CSV/TSV. Antes de guardar,
  la importacion muestra previsualizacion y permite definir teca,
  estado, prioridad por defecto y el manejo de duplicados (`Saltar`,
  `Actualizar` o `Duplicar`).
- El editor visible de obra muestra ficha descriptiva, fechas, total y
  descripcion, mas la organizacion de prioridad/motivo/origen.
  Las partes se editan en filas estructuradas dentro del modal
  (titulo, total, unidad y borrar/agregar), preservando el `Id` de cada
  parte existente para no romper avances historicos. El textarea crudo
  de partes queda oculto solo como compatibilidad interna. Los
  metadatos siguen sin editarse como textarea libre visible.
- Normalizacion de datos viejos y base inicial de demostracion cuando
  todavia no existe estado persistido de Decoteca.
- Las obras viejas sin campos de portada nueva siguen usando el modo
  `Emoji`; las portadas nuevas normalizan `Portada_Tipo`,
  `Portada_Url`, `Portada_Data_Url`, `Portada_Mime`,
  `Portada_Nombre` y `Portada_Tamano`.
- Los guardados de Decoteca usan el flujo de cambio critico cuando
  esta disponible, para subir al remoto sin depender del debounce
  normal.
- Boton propio `Decoteca_Boton` en el menu superior configurable.
- Modal `Decoteca_Overlay`.
- Desde la version de frontend `1.4.0`, la Decoteca con partes
  estructuradas y avances propios usa
  `Esquema_Estado_Version_Actual = 5`; versiones anteriores quedan
  limitadas a esquemas previos en el manifest.
- Desde la version de frontend `1.4.1`, el registro de Decoteca se
  presenta como modal/cartel independiente y no reemplaza el detalle de
  obra.
- Desde la version de frontend `1.4.2`, el registro de Decoteca usa la
  letra `D` y puede abrirse globalmente desde las secciones principales
  de Semaplan.
- Desde la version de frontend `1.4.3`, el cartel `D` queda limitado a
  registrar avances y el registro historico pasa al modal `R`; el
  selector de item de avance usa arbol anidado con tecas, obras y
  partes.

Tecas iniciales.

- Biblioteca: libros, capitulos, paginas, lectura y relectura.
- Musicoteca: albumes, canciones, escuchas y reescuchas.
- Videoteca: peliculas, visionados y revisionados; la duracion queda
  como dato descriptivo secundario.
- Ludoteca: juegos, sesiones y horas.

Funciones de entrada recomendadas.

- `Abrir_Decoteca()`
- `Cerrar_Decoteca()`
- `Render_Decoteca()`
- `Decoteca_Cambiar_Teca()`
- `Decoteca_Abrir_Nuevo()`
- `Decoteca_Abrir_Editar()`
- `Decoteca_Abrir_Caratula()`
- `Decoteca_Abrir_Nueva_Teca()`
- `Decoteca_Abrir_Editar_Teca()`
- `Decoteca_Guardar_Obra()`
- `Decoteca_Guardar_Caratula()`
- `Decoteca_Guardar_Teca()`
- `Decoteca_Reordenar_Obras()`
- `Decoteca_Aplicar_Accion_Masiva()`
- `Decoteca_Abrir_Importacion()`
- `Decoteca_Guardar_Importacion()`
- `Decoteca_Render_Partes_Editor()`
- `Decoteca_Leer_Partes_Form()`
- `Decoteca_Bajar_Metadatos()`
- `Decoteca_Buscar_Metadatos()`
- `Decoteca_Abrir_Avance()`
- `Decoteca_Guardar_Avance()`
- `Decoteca_Abrir_Registro()`
- `Decoteca_Render_Modal_Registro()`
- `Decoteca_Cerrar_Registro()`
- `Decoteca_Editar_Avance()`
- `Decoteca_Borrar_Avance()`
- `Decoteca_Borrar_Obra()`
- `Decoteca_Borrar_Teca()`
- `Normalizar_Decoteca()`

Relaciones importantes.

- Cada teca debe poder tener universo, campos y reglas propias.
- Las obras muestran caratula, estado, periodo de consumo, avance
  calculado, repeticiones, metadatos relevantes y subpartes.
- `Decoteca` entra en `Construir_Estado_Completo()`, `Cargar_Estado()`,
  `Normalizar_Estado()`, sync remoto e import/export como clave raiz
  normal del estado.

## Metas

Las metas son un sistema resumido de seguimiento por fuente.

Objeto central.

- `Metas`

Modelo basico de meta normalizada.

- `Id`
- `Nombre`
- `Horas_Objetivo`
- `Periodo`
- `Semana_Ref` o `Mes_Ref`
- `Fecha_Desde`
- `Fecha_Hasta`
- `Fuente_Tipo`
- `Fuente_Valor`
- `Fuente_Clave`
- `Archivada`

Funciones de entrada recomendadas.

- `Normalizar_Meta()`
- `Render_Metas()`
- `Cargar_Meta_En_Form()`

Relaciones importantes.

- Las metas resumen progreso por categoria, etiqueta u objetivo.
- Cambios en agenda y objetivos pueden cambiar indirectamente sus
  calculos y mensajes.
- La lista de Metas debe permitir busqueda por texto sobre nombre,
  fuente, periodo y estado visible, y cuando no haya coincidencias debe
  usar el vacio de `Sin resultados` en lugar del vacio general.
- Cuando la lista de Metas tenga busqueda o filtros activos, debe
  resumirlos en chips visibles y ofrecer `Limpiar` dentro del mismo
  modal para evitar filtros persistentes poco evidentes.
- En bloques vinculados a metas de planes por periodo, el aporte por
  bloque separa el aporte real del aporte sugerido. El contador muestra
  `Aporte a la meta: X (Y sugeridos)`, donde `X` suma el aporte general
  y los aportes de partes seleccionadas, e `Y` se calcula de forma
  proporcional a la duracion real del bloque cuando el objetivo tiene
  horas semanales. El aporte general arranca en cero, usa el mismo
  estilo que las partes y solo se registra si el usuario lo tilda y le
  asigna cantidad.
- Las metas sugeridas arrancan destildadas por defecto. El usuario debe
  marcar explicitamente que filas importar, incluso cuando el sistema ya
  calcule aporte, horas y partes sugeridas.
- En `Metas sugeridas`, un subobjetivo solo entra al listado si tiene
  fecha explicita propia y su rango cruza la semana visible. Los
  subobjetivos sin fecha explicita quedan fuera aunque tengan partes con
  fecha.

## Planes semanales

Este modulo guarda un snapshot del plan base de una semana y permite
compararlo con el estado actual.

Objeto central.

- `Planes_Semana`

Funciones de entrada recomendadas.

- `Obtener_Plan_Semana()`
- `Snapshot_Eventos_Semana()`
- `Calcular_Diff_Plan()`
- `Fijar_Plan_Semana()`
- `Cerrar_Plan_Semana()`
- `Render_Plan()`
- `Render_Planear()`
- `Render_Cerrar_Semana()`
- `Render_Historial_Planes()`

Relaciones importantes.

- El plan semanal depende de `Eventos`.
- Tiene nota inicial, nota de cierre, refijadas e historial.
- Cerrar semana puede disparar rollover hacia Baul o movimiento de
  eventos.

## Planes por periodos

Es el sistema jerarquico mas grande de la app.

La capa `Semana` de Planes es independiente de la jerarquia de anos,
semestres, trimestres y meses. Se consulta de lunes a domingo y no se
crean semanas como hijas de otros periodos. La cuota semanal es una
proyeccion informativa: se prorratea por dias calendario sobre los
periodos que se superponen con la semana, sin asignar tareas a dias
particulares.

En el detalle semanal, la cuota muestra únicamente los avances fechados
dentro de la semana. El compromiso y el trabajo operativo también se
prorratean: cada subobjetivo aporta la proporción de su rango planeado
que se superpone con la semana y sus páginas o unidades realizadas se
toman de los registros de ese período. Si no tiene `Fecha_Inicio` ni
`Fecha_Objetivo`, para esta lectura usa el período madre como rango de
reparto; no se trata a `Fecha_Fin` como planificación ni se lo incorpora a
`Metas sugeridas`.

Cuando una familia de objetivos tiene una madre anual, semestral,
trimestral o mensual, la cuota semanal usa siempre la madre de mayor
escala disponible, en ese orden. Si la semana cruza dos periodos de la
escala elegida, suma las porciones proporcionales de cada uno. Los
subobjetivos no cambian la fuente de la cuota: sus fechas planeadas, o el
período madre cuando no existen, determinan el trabajo y los avances que
entran en el contexto semanal.

Objeto central.

- `Planes_Periodo`

Subestructuras centrales.

- `Periodos`
- `Objetivos`
- `Subobjetivos`
- `Partes`
- `Avances`
- Cada avance puede guardar `Modo`, `Base` y `Hasta` para distinguir
  carga directa de `Avance hasta` sin perder la cantidad efectiva.
- Los subobjetivos pueden tener `Aporte_Meta_Automatico`; cuando está
  activo, el aporte a la meta se calcula desde sus avances propios y
  solo se suma si la unidad del subobjetivo coincide con la del padre.
  Ese aporte efectivo también se propaga al progreso realizado del
  objetivo padre, incluso cuando el valor persistido del progreso estaba
  desactualizado.
- `UI`

Funciones de entrada recomendadas.

- `Planes_Modelo_Base()`
- `Normalizar_Modelo_Planes()`
- `Normalizar_Periodo_Plan()`
- `Normalizar_Objetivo_Plan()`
- `Normalizar_Subobjetivo_Plan()`
- `Normalizar_Parte_Meta()`
- `Render_Planner_Periodos()`
- `Render_Planes_Contenido()`
- `Render_Planes_Objetivo()`
- `Render_Modal_Planes_Subobjetivos()`
- `Render_Modal_Planes_Partes()`
- `Render_Modal_Planes_Registro()`

Relaciones importantes.

- Un objetivo puede pertenecer a un periodo y a la vez colgar de otro
  objetivo padre.
- Un subobjetivo puede tener partes.
- Los subobjetivos admiten orden por métrica total, métrica realizada y
  porcentaje realizado. Los subobjetivos reprogramados conservan su
  historia, quedan en gris y no participan de cálculos ni listados por
  defecto; el filtro `Reprogramados` permite revisarlos.
- Reprogramar o trasladar el pendiente crea una rama equivalente en un
  período posterior, incluso en otra capa temporal, con sólo la carga
  restante. La rama original queda marcada como `Reprogramado`; al
  reactivarla, sus avances se devuelven a la rama original y la copia
  queda fuera de servicio.
- La lectura de cada subobjetivo muestra la métrica restante junto con
  las horas restantes cuando existe una unidad calculable. La lectura
  operativa de un hábito asociado también informa cuántos días activos
  quedan en su período.
- El resumen semanal cuenta bloques programados y realizados. Los slots
  muertos entran en el total programado, pero no se consideran realizados.
- Los menus de subobjetivos y partes permiten duplicar. El duplicado de
  subobjetivo clona su rama y el duplicado de parte crea una copia
  pendiente junto a la original, sin avances ni fecha/hora de cierre, y
  recalcula targets cuando el subobjetivo suma componentes.
- Objetivos, subobjetivos y partes pueden vincular habitos.
- El detalle expandido separa el resultado principal de la carga de
  trabajo. El resultado puede ser, por ejemplo, una obra terminada,
  mientras la carga operativa usa la unidad uniforme de sus
  subobjetivos. Esta relación es genérica y no presupone libros,
  páginas ni otro dominio particular.
- Al expandir un objetivo con hábito asociado no se repite una tarjeta de
  pauta. Tampoco existe un encabezado redundante con el período, el título
  `Situación del objetivo` y una explicación genérica: sólo se conserva el
  estado efectivo, integrado junto a la identidad y el avance global de la
  meta madre. Junto a `Meta madre` se muestra la periodicidad de su período
  base (`Anual`, `Semestral`, `Trimestral`, `Mensual` o `Personalizado`), no
  la capa hija visible. El tablero destaca tres porcentajes que no se
  deben mezclar: `Cuota esperada` compara resultados cumplidos contra la
  parte proporcional asignada al período; `Compromiso elegido` compara
  subobjetivos cumplidos contra los subobjetivos cargados para ese
  período; y `Trabajo operativo` compara unidades realizadas contra la
  carga uniforme total de esos subobjetivos.
- En cada capa temporal, la fila colapsada usa la misma cuota contextual que
  el detalle para porcentaje, realizado y pendiente; la meta madre expandida
  conserva el resumen global. No toma el `Target_Total` ni el
  `Progreso_Total` crudos de la meta anual, semestral, trimestral, mensual o
  semanal proyectada.
- `Trabajo operativo` muestra realizado sobre total en su cuenta principal.
  Debajo sólo desglosa las unidades pendientes y las que pertenecen a
  subobjetivos sin iniciar; no repite realizado ni muestra una descripción
  genérica de las cargas.
- El compromiso cuenta resultados raíz, no sus divisiones internas. Un
  subobjetivo cumplido conserva el período al que fue destinado según
  `Fecha_Inicio` y `Fecha_Objetivo`, aunque `Fecha_Fin` demuestre que se
  terminó antes o después. La fecha real registra conducta; no
  reescribe la decisión de planificación.
- Los porcentajes visibles pueden superar el 100 % para mostrar excesos
  reales. Solo la longitud de la barra se limita al ancho disponible.
  En cargas compuestas, el aporte de cada subobjetivo sí se topa por su
  propia meta para que un exceso interno no oculte otro pendiente.
- La lectura operativa resume cuántos subobjetivos y unidades quedan. Si
  existe un hábito asociado, agrega únicamente la cuota completa vigente
  por día activo; la cifra también se muestra en un día de descanso y no
  se reemplaza por el faltante de hoy. Las metas sin cuota, sin compromiso
  o con unidades mixtas muestran ausencia de cálculo en lugar de inventar
  un cero o una equivalencia. La cuota usa las fechas activas y excepciones
  del hábito vinculado, junto con la unidad efectiva de su carga operativa.
- `Planes_Carga_Trabajo_Objetivo()` construye un único inventario con
  todos los subobjetivos medibles del compromiso. Cada uno aporta una vez su
  target y su avance agregado de toda su familia; cuando el target deriva de
  sus partes, usa ese total consolidado sin excluir el subobjetivo ni volver
  a sumar las partes. En una capa temporal, tanto el target como los avances
  se restringen y prorratean por el rango consultado. Del mismo inventario
  salen total, realizado, pendiente y unidades de subobjetivos todavía sin
  avance. Si faltan métricas muestra cobertura parcial como mínimo conocido;
  si hay unidades distintas, no calcula una equivalencia ficticia. En una
  semana, los subobjetivos sin fechas planeadas se incluyen con el peso de su
  período padre, en vez de desaparecer de ese inventario.
- La `Pauta de hoy` usa el pool pendiente de unidades y los días activos
  restantes hasta el fin de la meta. El pool suma los targets de los
  subobjetivos medidos y resta el avance de cada uno con tope propio, de
  modo que un exceso en un subobjetivo no compensa otro pendiente.
  La cuota se redondea hacia arriba a unidades enteras para su uso diario.
  Cuando se consulta un objetivo hijo, el ritmo usa su target y su período
  contextual; la meta canónica sólo sigue aportando el contexto global.
  Si existen subobjetivos sin target individual pero la meta madre tiene
  una métrica global, el ritmo usa esa meta como fuente de palabras,
  páginas u otra unidad; esto no convierte esos subobjetivos en una
  carga operativa uniforme.
- Los ciclos de semanas tienen como mínimo dos semanas. Los hábitos
  guardados con una duración inválida de una semana se normalizan al
  patrón quincenal que permite configurar sus dos filas de días.
- Un subobjetivo sin target puede marcarse manualmente como realizado.
  El recálculo automático conserva ese estado y sólo lo deriva del avance
  numérico cuando existe un target mayor que cero.
- La primera evaluación de una jornada activa persiste una fotografía en
  `Ritmo_Diario_Historial`: pauta, pendiente inicial, días activos usados,
  unidad, total planificado y subobjetivos pendientes. La pauta queda
  inmutable; el realizado se sigue leyendo de `Avances`, por lo que una
  corrección histórica cambia el balance real sin alterar la consigna.
  Déficits y adelantos se absorben al calcular la próxima jornada activa.
- En el editor de un hábito de período diario, el campo `Meta` usa la
  misma cuota diaria que la pauta visible de Metas. Los períodos semanal,
  quincenal y mensual conservan su cálculo acumulado correspondiente.
- La cuota visible del editor y la pauta grande usan la misma fuente:
  si la jornada actual ya tiene una pauta fijada, esa pauta prevalece;
  si no, se usa la redistribución calculada para la próxima jornada válida.
  Al crear un hábito nuevo, una pauta de otro hábito no se considera válida:
  se reemplaza y se redistribuye según los días activos del nuevo hábito.
  Al eliminar el hábito se eliminan también sus registros de
  `Ritmo_Diario_Historial`.
- Un hábito de ritmo cualitativo (`Check`) se sincroniza con cada avance
  aunque el avance tenga una unidad distinta o el hábito no tenga métrica
  cuantitativa propia. Los hábitos cuantitativos siguen exigiendo unidad
  compatible antes de registrar el avance.
- Para esa sincronización se usa la carga de ritmo de la meta, no la carga
  operativa de sus subobjetivos: una meta global cuantificada sigue
  sincronizando aunque sus subobjetivos sean cualitativos o no tengan target.
- Al cargar el estado, los registros de hábitos de ritmo se reconstruyen
  desde los avances existentes; esto repara también avances guardados antes
  de una corrección de sincronización.
- Las opciones de un hábito vinculado a una meta de ritmo incluyen
  `Actualizar vínculo`. Esa acción reconstruye sus registros desde los
  avances persistidos, guarda el estado, refresca Metas y Hábitos e informa
  la próxima pauta. La pauta del día actual permanece fijada; el nuevo
  reparto se aplica al siguiente día activo. Antes de ejecutar la reparación,
  un diálogo muestra los pendientes, el rango del objetivo, los días activos
  futuros —sin contar hoy— y la cuota redondeada; cancelar deja el vínculo
  intacto.
- Los avances anteriores a `Fecha_Inicio` del hábito no cuentan para su
  progreso. Si cambia la unidad, los registros anteriores se conservan como
  historial pero no se mezclan con la unidad nueva; sólo los avances
  compatibles alimentan el estado actual.
- La tarjeta de pauta ampliada sólo se conserva mientras la meta todavía
  no tenga hábito, porque contiene la acción para crearlo. Una vez asentado
  el vínculo desaparecen de este detalle el realizado de hoy, el faltante,
  el pool, los días válidos, el historial y las acciones del hábito.
- `Crear hábito asociado` abre el editor de Hábitos ya contextualizado.
  El nombre de la acción sigue siendo editable y la programación puede
  ser semanal, por días del mes, por ciclo de días o por ciclo de
  semanas, con fechas activas o inactivas excepcionales. Los campos de
  cantidad y unidad quedan derivados de la meta. La cantidad se
  recalcula en vivo al cambiar el período o cualquier dato que altere
  los días válidos, incluida la fecha de inicio. El cálculo de esa
  cantidad ignora la fotografía histórica de hoy, pero nunca la
  modifica. La lectura operativa conserva la cuota completa fijada o
  calculada por día activo. Si hoy no corresponde, la cantidad se deriva
  desde la primera fecha válida futura.
- El historial diario y los nuevos patrones de días forman parte del
  esquema de estado 8. Las versiones cuyo máximo de esquema sea 7 no
  deben habilitarse para ese estado, porque descartarían esos datos al
  normalizar y volver a guardar.
- El modal de registrar avance usa un selector visual en arbol: agrupa
  por anio, objetivo, subobjetivo y parte. Los nodos con boton `+`
  siguen siendo seleccionables; el boton solo abre o cierra la rama. Al
  abrir una rama se cierran sus hermanos del mismo nivel y la expansion
  queda recordada localmente para la proxima apertura con `M`.
- El registro de avance admite cantidad directa o `Avance hasta`. En
  ese segundo modo toma como base el progreso actual del item
  seleccionado y calcula la cantidad efectiva a partir del valor final
  ingresado. Esa base y el modo quedan persistidos para que la edicion
  posterior conserve el contexto.
- La descripcion de un periodo en Metas se muestra contraida cuando ya
  tiene texto. El boton propio de expansion solo contrae o expande; el
  click en el cuerpo de la descripcion sigue abriendo la edicion.
- Los avances recalculan progreso y pueden afectar vistas, estados y
  metricas.
- En los editores de Subobjetivos y Partes, `Fecha_Inicio` y
  `Fecha_Objetivo` siguen siendo editables aunque el ítem ya esté
  cumplido o realizado. `Fecha_Fin` conserva el cierre real y queda
  bloqueada, calculada desde el último avance registrado.
- El registro historico de avances permite editar cantidad, modo, fecha,
  hora y destino dentro de la misma familia de meta: objetivo, subobjetivo
  o parte. Al reasignar, se actualizan fuente, unidad, progreso manual,
  avances del hijo y progreso de la meta; el destino forma parte de la
  comparacion de cambios para no descartar ediciones que solo cambian
  "a quien" se adjudica el avance.
- Los objetivos, subobjetivos y partes admiten valores metricos
  opcionales. Un campo vacio conserva el valor como no definido, no como
  cero: se pueden registrar avances sin limite conocido y esos avances
  siguen sumando al progreso real de la meta. El aporte a la meta solo
  se contabiliza cuando tiene un valor explicito. Si el aporte queda sin
  definir, el avance real del hijo se suma a la meta padre solo cuando
  ambas unidades son compatibles; no se inventan conversiones. Los
  porcentajes, faltantes y limites se omiten mientras el objetivo siga
  sin definir.

## Configuracion, backups e import/export

La configuracion no es decorativa: cambia comportamiento real de la
app.

Areas importantes.

- visibilidad de dias y horas
- memoria manual de dias y bloques horarios visibles de la semana
  actual, persistida en `Config_Extra` sin convertirla en default
  automatico global
- al navegar de semana, los filtros manuales de la semana actual se
  conservan en su memoria dedicada; los filtros manuales de semanas no
  actuales son transitorios por semana y no deben pisar esa memoria
- filtros automaticos
- vista automatica de horario con tres modos (`Completo`, `Enfocar`
  y `Por bloques`), limitada a la semana actual y siempre por debajo
  de los filtros manuales del encabezado
- comportamiento de habitos en sidebar
- colores y modos de UI
- datos de cuenta y tokens de integracion IA con scopes
- backups locales
- import/export completo
- selector de versiones del frontend

Funciones de entrada recomendadas.

- `Renderizar_Datos_Cuenta()`
- `Cargar_Tokens_IA_Cuenta()`
- `Crear_Token_IA_Cuenta()`
- `Renombrar_Token_IA_Cuenta()`
- `Revocar_Token_IA_Cuenta()`
- `Eliminar_Token_IA_Cuenta()`
- `Render_Config_Backups()`
- `Cargar_Backups_Locales()`
- `Aplicar_Importacion_Objeto()`
- `Render_Config_Versiones_Programa()`
- `Cargar_Registro_Versiones_Programa()`

Notas operativas de este bloque.

- Los tokens IA se generan en cliente y solo se guarda `token_hash`
  en `tokens_ia_usuario`.
- Los tokens pueden tener `read` y scopes B2 especificos:
  `write_tasks`, `write_habits`, `write_metas`, `write_archivero` y
  `write_baul`.
- El token plano se muestra una sola vez en la UI de Cuenta y no debe
  persistirse en estado ni en `localStorage`.
- La UI de Cuenta permite renombrar tokens, revocarlos y eliminar del
  historial visible los que ya fueron revocados, sin recuperar nunca el
  valor plano.
- Las mutaciones B2 se auditan en `ia_mutaciones_usuario`; la tabla
  `ia_confirmaciones_usuario` queda reservada para confirmaciones
  persistidas futuras.
- Si el entorno remoto todavia no tiene la tabla
  `tokens_ia_usuario`, la UI debe degradar con mensaje claro y sin
  intentar crear tokens.

## Orden sugerido de lectura cuando haya que tocar algo

1. Leer `Reglas_Operativas_Semaplan.md`.
2. Leer este archivo para ubicar el subsistema correcto.
3. Buscar la funcion normalizadora de ese subsistema.
4. Buscar sus renders principales.
5. Revisar `Construir_Estado_Completo()`, `Cargar_Estado()` y
   `Guardar_Estado()` si el cambio toca persistencia o sync.

## Cuando actualizar este documento

Actualizar este archivo en el mismo turno cuando haya alguno de estos
cambios.

- nueva pantalla o modulo operativo;
- cambio en flujos visibles importantes;
- cambio en claves persistidas o relaciones entre modulos;
- cambio en carga, guardado, import/export o sync;
- cambio que vuelva engañoso este panorama funcional.

Si el cambio es solo estetico o microcopy puro y no altera flujos ni
estado, no hace falta tocar este archivo.
