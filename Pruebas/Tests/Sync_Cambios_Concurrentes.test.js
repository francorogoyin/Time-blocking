const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const Ruta_Login = path.resolve(__dirname, "../../login.html");
const Codigo_Login = fs.readFileSync(Ruta_Login, "utf8");

function Extraer_Funcion(Nombre) {
  let Inicio = Codigo_Login.indexOf(`function ${Nombre}(`);
  assert.notEqual(
    Inicio,
    -1,
    `No se encontro la funcion ${Nombre}`
  );
  if (Codigo_Login.slice(Inicio - 6, Inicio) === "async ") {
    Inicio -= 6;
  }
  const Fin_Parametros = Codigo_Login.indexOf(") {", Inicio);
  assert.notEqual(
    Fin_Parametros,
    -1,
    `No se encontro el cuerpo de ${Nombre}`
  );
  const Inicio_Cuerpo = Fin_Parametros + 2;
  let Profundidad = 0;
  for (
    let Indice = Inicio_Cuerpo;
    Indice < Codigo_Login.length;
    Indice += 1
  ) {
    if (Codigo_Login[Indice] === "{") Profundidad += 1;
    if (Codigo_Login[Indice] === "}") Profundidad -= 1;
    if (Profundidad === 0) {
      return Codigo_Login.slice(Inicio, Indice + 1);
    }
  }
  throw new Error(`La funcion ${Nombre} quedo incompleta`);
}

function Crear_Storage(Inicial = {}, Al_Escribir = null) {
  const Datos = new Map(
    Object.entries(Inicial).map(([Clave, Valor]) => [
      Clave,
      String(Valor)
    ])
  );
  return {
    getItem(Clave) {
      return Datos.has(Clave) ? Datos.get(Clave) : null;
    },
    setItem(Clave, Valor) {
      Al_Escribir?.(Clave, String(Valor), Datos);
      Datos.set(Clave, String(Valor));
    },
    removeItem(Clave) {
      Datos.delete(Clave);
    }
  };
}

function Crear_Entorno_Persistencia({
  Storage = Crear_Storage(),
  Candidatos_Backup = [[]]
} = {}) {
  const Eventos = { Avisos: 0 };
  const Contexto = {
    localStorage: Storage,
    Clave_Local: "estado",
    Clave_Local_Usuario: "usuario",
    Backups_Locales: [],
    Backups_Locales_Cargados: false,
    Persistencia_Local_Fallo: false,
    Clave_Sync_Pendiente_Usuario: (Id) => `pendiente_${Id}`,
    Obtener_Clave_Backups_Actual: () => "backups",
    Crear_Candidatos_Backups_Cuota: () => Candidatos_Backup,
    Es_Error_Cuota_Storage: (Error) =>
      Error?.name === "QuotaExceededError" || Error?.code === 22,
    Avisar_Fallo_Persistencia_Local: (Error) => {
      Eventos.Avisos += 1;
      Eventos.Error = {
        Nombre: Error?.name,
        Mensaje: Error?.message,
        Codigo: Error?.code
      };
    }
  };
  vm.createContext(Contexto);
  vm.runInContext(
    Extraer_Funcion("Persistir_Estado_Local_Seguro"),
    Contexto
  );
  return { Contexto, Eventos, Storage };
}

function Crear_Entorno({
  Revision_Actual = 1,
  Estado_Local = {},
  Sucio = true
} = {}) {
  const Eventos = {
    Programaciones: 0,
    Emisiones: 0,
    Sucios: [],
    Timers_Limpiados: []
  };
  const Contexto = {
    Sync_Local_Revision: Revision_Actual,
    Sync_Local_Sucio: Sucio,
    Sync_Reintento_Timer_Id: null,
    Sync_Reintento_Intentos: 3,
    Sync_Remoto_Fila_Existe: false,
    Sync_Remoto_Estado_Ultimo: null,
    Sync_Remoto_Version_Actual: 4,
    structuredClone,
    console
  };

  Contexto.clearTimeout = (Id) => {
    Eventos.Timers_Limpiados.push(Id);
  };
  Contexto.Clonar_Estado_Sync = (Estado) =>
    structuredClone(Estado);
  Contexto.Actualizar_Marca_Datos_Sync_Desde_Estado =
    () => {};
  Contexto.Actualizar_Meta_Remota = (Datos) => {
    if (Datos?.version) {
      Contexto.Sync_Remoto_Version_Actual = Datos.version;
    }
  };
  Contexto.Marcar_Sync_Remoto_Actualizado = () => {};
  Contexto.Guardar_Base_Sync_Persistida = async () => true;
  Contexto.Leer_Estado_Local_Cache_Sync = () =>
    structuredClone(Estado_Local);
  Contexto.Fusionar_Estado_Raiz_Faltante = (Base, Nuevo) => ({
    ...(Base || {}),
    ...(Nuevo || {})
  });
  Contexto.Estados_Datos_Sync_Iguales = (A, B) =>
    JSON.stringify(A) === JSON.stringify(B);
  Contexto.Marcar_Sync_Local_Sucio = (Valor) => {
    Contexto.Sync_Local_Sucio = Boolean(Valor);
    Eventos.Sucios.push(Boolean(Valor));
  };
  Contexto.Backend_Sync_Programar = () => {
    Eventos.Programaciones += 1;
  };
  Contexto.Emitir_Evento_Local_Sync = () => {
    Eventos.Emisiones += 1;
  };

  vm.createContext(Contexto);
  vm.runInContext(
    Extraer_Funcion("Backend_Registrar_Sync_Exitoso"),
    Contexto
  );
  return { Contexto, Eventos };
}

function Crear_Entorno_Rebase() {
  const Contexto = {
    Date,
    JSON,
    Map,
    Set,
    console
  };
  Contexto.Obtener_Marca_Datos_Sync = (Estado) => {
    return Number(Estado?.Sync_Datos_Marca_Ms) || 0;
  };
  vm.createContext(Contexto);
  const Funciones = [
    "Es_Objeto_Json",
    "Normalizar_Json_Para_Comparacion",
    "Limpiar_Tombstones_Json",
    "Estado_Sin_Metadata_Operativa",
    "Estados_Datos_Sync_Iguales",
    "Valores_Json_Sync_Iguales",
    "Clonar_Valor_Json_Sync",
    "Obtener_Clave_Entidad_Sync",
    "Array_Sync_Identificable",
    "Mapa_Array_Entidad_Sync",
    "Orden_Array_Entidad_Sync",
    "Combinar_Array_Entidades_Sync",
    "Combinar_Objeto_Concurrente_Sync",
    "Combinar_Valor_Concurrente_Sync",
    "Combinar_Estados_Concurrentes"
  ];
  for (const Nombre of Funciones) {
    vm.runInContext(Extraer_Funcion(Nombre), Contexto);
  }
  return Contexto;
}

test("confirma solo la misma revision sincronizada", () => {
  const Estado = {
    Eventos: [{ Id: "Evento_1" }],
    Tareas: [{ Id: "Tarea_1" }]
  };
  const { Contexto, Eventos } = Crear_Entorno({
    Revision_Actual: 7,
    Estado_Local: Estado
  });

  const Resultado = Contexto.Backend_Registrar_Sync_Exitoso(
    { version: 5 },
    Estado,
    {
      Confirmar_Datos_Locales: true,
      Revision_Local: 7
    }
  );

  assert.equal(Resultado.Hay_Cambio_Posterior, false);
  assert.equal(Contexto.Sync_Local_Sucio, false);
  assert.equal(Eventos.Programaciones, 0);
  assert.equal(Eventos.Emisiones, 1);
});

test("acepta el mismo estado con propiedades reordenadas", () => {
  const Estado_Enviado = {
    Eventos: [
      { Id: "Evento_1", Titulo: "Reunion", Hora: "10:00" }
    ],
    Config: { Vista: "Semana", Tema: "Oscuro" }
  };
  const Estado_Local = {
    Config: { Tema: "Oscuro", Vista: "Semana" },
    Eventos: [
      { Hora: "10:00", Titulo: "Reunion", Id: "Evento_1" }
    ]
  };
  const { Contexto, Eventos } = Crear_Entorno({
    Revision_Actual: 7,
    Estado_Local
  });
  Contexto.Es_Objeto_Json = (Valor) => Boolean(
    Valor &&
    typeof Valor === "object" &&
    !Array.isArray(Valor)
  );
  Contexto.Estado_Sin_Metadata_Operativa = (Estado) =>
    Estado;
  vm.runInContext(
    Extraer_Funcion("Normalizar_Json_Para_Comparacion"),
    Contexto
  );
  vm.runInContext(
    Extraer_Funcion("Estados_Datos_Sync_Iguales"),
    Contexto
  );

  const Resultado = Contexto.Backend_Registrar_Sync_Exitoso(
    { version: 5 },
    Estado_Enviado,
    {
      Confirmar_Datos_Locales: true,
      Revision_Local: 7
    }
  );

  assert.equal(Resultado.Hay_Cambio_Posterior, false);
  assert.equal(Contexto.Sync_Local_Sucio, false);
  assert.equal(Eventos.Programaciones, 0);
});

test("conserva pendiente una revision creada durante el envio", () => {
  const Estado_Enviado = {
    Habitos_Registros: [{ Id: "Registro_1" }]
  };
  const Estado_Local = {
    Habitos_Registros: [
      { Id: "Registro_1" },
      { Id: "Registro_2" }
    ]
  };
  const { Contexto, Eventos } = Crear_Entorno({
    Revision_Actual: 8,
    Estado_Local
  });

  const Resultado = Contexto.Backend_Registrar_Sync_Exitoso(
    { version: 5 },
    Estado_Enviado,
    {
      Confirmar_Datos_Locales: true,
      Revision_Local: 7
    }
  );

  assert.equal(Resultado.Hay_Cambio_Posterior, true);
  assert.equal(Contexto.Sync_Local_Sucio, true);
  assert.equal(Eventos.Programaciones, 1);
  assert.equal(Eventos.Emisiones, 0);
});

test("detecta contenido posterior aunque la revision no cambie", () => {
  const Estado_Enviado = {
    Notas_Archivero: [{ Id: "Nota_1", Texto: "Antes" }]
  };
  const Estado_Local = {
    Notas_Archivero: [{ Id: "Nota_1", Texto: "Despues" }]
  };
  const { Contexto, Eventos } = Crear_Entorno({
    Revision_Actual: 3,
    Estado_Local
  });

  const Resultado = Contexto.Backend_Registrar_Sync_Exitoso(
    null,
    Estado_Enviado,
    {
      Confirmar_Datos_Locales: true,
      Revision_Local: 3
    }
  );

  assert.equal(Resultado.Hay_Cambio_Posterior, true);
  assert.equal(Contexto.Sync_Local_Sucio, true);
  assert.equal(Eventos.Programaciones, 1);
});

test("un guardado operativo no limpia cambios de datos", () => {
  const Estado = {
    Tareas: [{ Id: "Tarea_1" }],
    Sesiones_Operativas: { Activas: {} }
  };
  const { Contexto, Eventos } = Crear_Entorno({
    Revision_Actual: 4,
    Estado_Local: Estado,
    Sucio: true
  });
  Contexto.Sync_Reintento_Timer_Id = 23;

  const Resultado = Contexto.Backend_Registrar_Sync_Exitoso(
    { version: 5 },
    Estado
  );

  assert.equal(Resultado.Datos_Confirmados, false);
  assert.equal(Contexto.Sync_Local_Sucio, true);
  assert.deepEqual(Eventos.Sucios, []);
  assert.equal(Eventos.Programaciones, 0);
  assert.deepEqual(Eventos.Timers_Limpiados, []);
});

test("reconoce timeouts de servidor y cancelacion cliente", () => {
  const Contexto = {};
  vm.createContext(Contexto);
  vm.runInContext(
    Extraer_Funcion("Sync_Error_Timeout_Query"),
    Contexto
  );

  assert.equal(
    Contexto.Sync_Error_Timeout_Query({ code: "57014" }),
    true
  );
  assert.equal(
    Contexto.Sync_Error_Timeout_Query({
      name: "AbortError",
      message: "The operation was aborted"
    }),
    true
  );
  assert.equal(
    Contexto.Sync_Error_Timeout_Query({
      message: "signal timed out"
    }),
    true
  );
  assert.equal(
    Contexto.Sync_Error_Timeout_Query({
      message: "duplicate key"
    }),
    false
  );
});

test("considera una promesa en curso como sync pendiente", () => {
  const Contexto = {
    Sync_Timer_Id: null,
    Sync_Reintento_Timer_Id: null,
    Sync_En_Curso: false,
    Sync_Promesa_En_Curso: Promise.resolve(true)
  };
  vm.createContext(Contexto);
  vm.runInContext(
    Extraer_Funcion("Hay_Sync_Pendiente"),
    Contexto
  );

  assert.equal(Contexto.Hay_Sync_Pendiente(), true);
});

test("el sync no hace una prelectura remota redundante", () => {
  const Codigo_Sync = Extraer_Funcion(
    "Backend_Sync_Ejecutar"
  );

  assert.doesNotMatch(
    Codigo_Sync,
    /Backend_Verificar_Remoto_Antes_De_Sync/
  );
  assert.match(
    Codigo_Sync,
    /Es_Conflicto_Sync/
  );
});

test("persiste y verifica estado, usuario y marca pendiente", () => {
  const { Contexto, Eventos, Storage } =
    Crear_Entorno_Persistencia();
  const Estado = {
    Objetivos: [{ Id: "Objetivo_1" }],
    Tareas: [{ Id: "Tarea_1" }]
  };

  const Resultado = Contexto.Persistir_Estado_Local_Seguro(
    Estado,
    {
      Id_Usuario: "Usuario_1",
      Marcar_Pendiente: true
    }
  );

  assert.equal(
    Resultado.Ok,
    true,
    JSON.stringify({
      Resultado,
      Eventos,
      Backups: Storage.getItem("backups")
    })
  );
  assert.equal(Resultado.Cambio, true);
  assert.equal(Storage.getItem("estado"), JSON.stringify(Estado));
  assert.equal(Storage.getItem("usuario"), "Usuario_1");
  assert.ok(Storage.getItem("pendiente_Usuario_1"));
  assert.equal(Eventos.Avisos, 0);
});

test("libera backups y reintenta cuando falta cuota local", () => {
  const Storage = Crear_Storage(
    { backups: '[{"Id":"Backup_1"}]' },
    (Clave, _Valor, Datos) => {
      if (Clave !== "estado") return;
      if (Datos.get("backups") === "[]") return;
      const Error_Cuota = new Error("Sin cuota");
      Error_Cuota.name = "QuotaExceededError";
      Error_Cuota.code = 22;
      throw Error_Cuota;
    }
  );
  const { Contexto, Eventos } = Crear_Entorno_Persistencia({
    Storage,
    Candidatos_Backup: [[]]
  });
  const Estado = { Metas: [{ Id: "Meta_1" }] };

  const Resultado = Contexto.Persistir_Estado_Local_Seguro(
    Estado,
    {
      Id_Usuario: "Usuario_1",
      Marcar_Pendiente: true
    }
  );

  assert.equal(
    Resultado.Ok,
    true,
    JSON.stringify({
      Resultado,
      Eventos,
      Backups: Storage.getItem("backups")
    })
  );
  assert.equal(Storage.getItem("backups"), "[]");
  assert.equal(Storage.getItem("estado"), JSON.stringify(Estado));
  assert.equal(Eventos.Avisos, 0);
});

test("informa un fallo local que no puede persistir", () => {
  const { Contexto, Eventos } = Crear_Entorno_Persistencia();
  const Estado_Circular = {};
  Estado_Circular.Mismo = Estado_Circular;

  const Resultado = Contexto.Persistir_Estado_Local_Seguro(
    Estado_Circular
  );

  assert.equal(Resultado.Ok, false);
  assert.equal(Eventos.Avisos, 1);
});

test("los reintentos remotos no tienen un limite terminal", () => {
  let Demora_Programada = 0;
  const Contexto = {
    Supa: {},
    Usuario_Actual: { id: "Usuario_1" },
    Sync_Conflicto_Pendiente: false,
    Sync_Local_Sucio: true,
    Sync_Timer_Id: null,
    Sync_En_Curso: false,
    Sync_Promesa_En_Curso: null,
    Sync_Reintento_Timer_Id: null,
    Sync_Reintento_Intentos: 999,
    Sync_Reintento_Demoras_Ms: [2000, 5000, 300000],
    Backend_Sync_Ejecutar: () => {},
    setTimeout: (_Funcion, Demora) => {
      Demora_Programada = Demora;
      return 77;
    }
  };
  vm.createContext(Contexto);
  vm.runInContext(
    Extraer_Funcion("Obtener_Demora_Reintento_Sync"),
    Contexto
  );
  vm.runInContext(
    Extraer_Funcion("Programar_Reintento_Sync"),
    Contexto
  );

  assert.equal(Contexto.Programar_Reintento_Sync(), true);
  assert.equal(Contexto.Sync_Reintento_Intentos, 1000);
  assert.equal(Demora_Programada, 300000);
});

test("un fallo remoto inicial no descarta cambios locales", () => {
  const Codigo_Inicio = Extraer_Funcion("Iniciar_App_Logueada");
  const Inicio_Error = Codigo_Inicio.indexOf(
    "if (Fila_Remota.error)"
  );
  const Fin_Error = Codigo_Inicio.indexOf(
    "} else if (Fila_Remota.data)",
    Inicio_Error
  );
  const Rama_Error = Codigo_Inicio.slice(Inicio_Error, Fin_Error);

  assert.doesNotMatch(
    Rama_Error,
    /Hay_Sync_Local_Pendiente\s*=\s*false/
  );
  assert.doesNotMatch(
    Rama_Error,
    /Backend_Cargar_Estado_Remoto/
  );
  assert.match(Rama_Error, /carga_inicial_remota/);
});

test("una carga remota fallida no se confunde con usuario nuevo", async () => {
  const Contexto = {
    Supa: {},
    Usuario_Actual: { id: "Usuario_1" },
    Backend_Leer_Fila_Remota: async () => ({
      data: null,
      error: new Error("Sin conexion")
    }),
    console: { error: () => {} }
  };
  vm.createContext(Contexto);
  vm.runInContext(
    Extraer_Funcion("Backend_Cargar_Estado_Remoto"),
    Contexto
  );

  const Resultado =
    await Contexto.Backend_Cargar_Estado_Remoto();
  const Codigo_Inicio = Extraer_Funcion("Iniciar_App_Logueada");

  assert.equal(Resultado, null);
  assert.match(
    Codigo_Inicio,
    /!Habia_Remoto\s*&&\s*!Carga_Remota_No_Confirmada/
  );
});

test("cerrar la app no muestra una advertencia de sync", () => {
  const Codigo_Bootstrap = Extraer_Funcion("Bootstrap");

  assert.doesNotMatch(Codigo_Bootstrap, /preventDefault/);
  assert.doesNotMatch(Codigo_Bootstrap, /returnValue/);
  assert.match(Codigo_Bootstrap, /"beforeunload"/);
  assert.match(Codigo_Bootstrap, /"online"/);
});

test("combina cambios independientes de distintos modulos", () => {
  const Contexto = Crear_Entorno_Rebase();
  const Base = {
    Habitos: [{ Id: "Habito_1", Nombre: "Leer" }],
    Eventos: [{ Id: "Evento_1", Titulo: "Base" }],
    Config_Extra: { Menu_Estilo: "Iconos" }
  };
  const Local = structuredClone(Base);
  Local.Habitos.push({ Id: "Habito_2", Nombre: "Caminar" });
  const Remoto = structuredClone(Base);
  Remoto.Eventos.push({ Id: "Evento_2", Titulo: "Remoto" });

  const Resultado = Contexto.Combinar_Estados_Concurrentes(
    Base,
    Local,
    Remoto,
    "Remoto"
  );

  assert.equal(Resultado.Estado.Habitos.length, 2);
  assert.equal(Resultado.Estado.Eventos.length, 2);
  assert.equal(Resultado.Conflictos.length, 0);
});

test("combina ediciones de entidades distintas del mismo modulo", () => {
  const Contexto = Crear_Entorno_Rebase();
  const Base = {
    Tareas: [
      { Id: "Tarea_1", Titulo: "Uno", Estado: "Pendiente" },
      { Id: "Tarea_2", Titulo: "Dos", Estado: "Pendiente" }
    ]
  };
  const Local = structuredClone(Base);
  Local.Tareas[0].Estado = "Completada";
  const Remoto = structuredClone(Base);
  Remoto.Tareas[1].Titulo = "Dos remoto";
  Remoto.Tareas.push({
    Id: "Tarea_3",
    Titulo: "Tres",
    Estado: "Pendiente"
  });

  const Resultado = Contexto.Combinar_Estados_Concurrentes(
    Base,
    Local,
    Remoto,
    "Local"
  );
  const Por_Id = new Map(
    Resultado.Estado.Tareas.map((Item) => [Item.Id, Item])
  );

  assert.equal(Por_Id.size, 3);
  assert.equal(Por_Id.get("Tarea_1").Estado, "Completada");
  assert.equal(Por_Id.get("Tarea_2").Titulo, "Dos remoto");
  assert.equal(Por_Id.get("Tarea_3").Titulo, "Tres");
  assert.equal(Resultado.Conflictos.length, 0);
});

test("conserva un alta remota junto a un borrado local valido", () => {
  const Contexto = Crear_Entorno_Rebase();
  const Base = {
    Notas_Archivero: [
      { Id: "Nota_1", Titulo: "Borrar" },
      { Id: "Nota_2", Titulo: "Conservar" }
    ]
  };
  const Local = {
    Notas_Archivero: [
      { Id: "Nota_2", Titulo: "Conservar" }
    ]
  };
  const Remoto = {
    Notas_Archivero: [
      ...Base.Notas_Archivero,
      { Id: "Nota_3", Titulo: "Nueva remota" }
    ]
  };

  const Resultado = Contexto.Combinar_Estados_Concurrentes(
    Base,
    Local,
    Remoto,
    "Local"
  );
  const Ids = Resultado.Estado.Notas_Archivero
    .map((Item) => Item.Id)
    .sort();

  assert.deepEqual(Array.from(Ids), ["Nota_2", "Nota_3"]);
});

test("una edicion remota impide que un cache viejo borre la entidad", () => {
  const Contexto = Crear_Entorno_Rebase();
  const Base = {
    Decoteca: {
      Obras: [{ Id: "Obra_1", Titulo: "Antes" }]
    }
  };
  const Local = { Decoteca: { Obras: [] } };
  const Remoto = {
    Decoteca: {
      Obras: [{ Id: "Obra_1", Titulo: "Despues" }]
    }
  };

  const Resultado = Contexto.Combinar_Estados_Concurrentes(
    Base,
    Local,
    Remoto,
    "Local"
  );

  assert.equal(Resultado.Estado.Decoteca.Obras.length, 1);
  assert.equal(
    Resultado.Estado.Decoteca.Obras[0].Titulo,
    "Despues"
  );
  assert.ok(Resultado.Conflictos.length >= 1);
});

test("resuelve un mismo campo segun el contexto del rebase", () => {
  const Contexto = Crear_Entorno_Rebase();
  const Base = {
    Config_Extra: { Menu_Estilo: "Iconos" }
  };
  const Local = {
    Config_Extra: { Menu_Estilo: "Hamburguesa" }
  };
  const Remoto = {
    Config_Extra: { Menu_Estilo: "Iconos compactos" }
  };

  const Inicio = Contexto.Combinar_Estados_Concurrentes(
    Base,
    Local,
    Remoto,
    "Remoto"
  );
  const Activo = Contexto.Combinar_Estados_Concurrentes(
    Base,
    Local,
    Remoto,
    "Local"
  );

  assert.equal(
    Inicio.Estado.Config_Extra.Menu_Estilo,
    "Iconos compactos"
  );
  assert.equal(
    Activo.Estado.Config_Extra.Menu_Estilo,
    "Hamburguesa"
  );
});

test("keepalive exige confirmacion versionada del servidor", () => {
  const Codigo = Extraer_Funcion(
    "Backend_Sync_Forzar_Keepalive"
  );

  assert.match(Codigo, /aplicar_estado_usuario_web/);
  assert.match(Codigo, /sync_conflict_keepalive_sin_confirmacion/);
  assert.doesNotMatch(Codigo, /return=minimal/);
  assert.doesNotMatch(Codigo, /method:\s*"PATCH"/);
});

test("la importacion usa el mismo sync seguro", () => {
  const Codigo = Extraer_Funcion(
    "Aplicar_Importacion_Objeto"
  );

  assert.match(Codigo, /Marcar_Sync_Local_Sucio\(true\)/);
  assert.match(Codigo, /Backend_Sync_Ejecutar/);
  assert.doesNotMatch(Codigo, /\.upsert\(/);
});

test("la base bloquea escrituras directas de clientes viejos", () => {
  const Ruta_Migracion = path.resolve(
    __dirname,
    "../../supabase/migrations/" +
      "202608092233_estado_usuario_rpc_web_segura.sql"
  );
  const SQL = fs.readFileSync(Ruta_Migracion, "utf8");

  assert.match(SQL, /aplicar_estado_usuario_web/);
  assert.match(SQL, /p_version_esperada/);
  assert.match(SQL, /p_cliente_version/);
  assert.match(SQL, /semaplan_cliente_obsoleto/);
  assert.match(
    SQL,
    /drop policy if exists "Estado propio: actualizar"/
  );
  assert.doesNotMatch(
    Codigo_Login,
    /\.from\("estado_usuario"\)\s*\.(update|insert|upsert)\(/
  );
});

test("el selector bloquea releases obsoletos aunque compartan esquema", () => {
  const Manifest = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "Aplicaciones",
        "Web_Versiones",
        "Manifest_Versiones.json"
      ),
      "utf8"
    )
  );
  const Actual = Manifest.find((Item) => Item.Id === "1.16.1");

  assert.equal(Actual?.Estado, "stable");
  assert.equal(Actual?.Archivo, "Semaplan_Version_1_16_1.html");
  assert.equal(Actual?.Esquema_Estado_Min, 14);
  assert.equal(Actual?.Esquema_Estado_Max, 14);
  assert.match(
    Codigo_Login,
    /Version\.Estado[\s\S]*?=== "deprecated"[\s\S]*?return false;/
  );
});

test("el contrato cubre todos los modulos persistidos", () => {
  const Codigo_Estado = Extraer_Funcion(
    "Construir_Estado_Completo"
  );
  const Codigo_Carga = Extraer_Funcion("Cargar_Estado");
  const Claves = [
    "Objetivos",
    "Eventos",
    "Metas",
    "Slots_Muertos",
    "Plantillas_Subobjetivos",
    "Planes_Slot",
    "Categorias",
    "Etiquetas",
    "Baul_Objetivos",
    "Decoteca",
    "Baul_Grupos_Colapsados",
    "Archiveros",
    "Notas_Archivero",
    "Etiquetas_Archivero",
    "Patrones",
    "Habitos",
    "Habitos_Registros",
    "Retos",
    "Tareas",
    "Tareas_Cajones_Definidos",
    "Config_Extra",
    "Tipos_Slot",
    "Slots_Muertos_Tipos",
    "Semanas_Con_Defaults",
    "Planes_Semana",
    "Planes_Periodo"
  ];

  for (const Clave of Claves) {
    assert.match(
      Codigo_Estado,
      new RegExp(`\\b${Clave}\\b`)
    );
    assert.match(
      Codigo_Carga,
      new RegExp(`\\b${Clave}\\b`)
    );
  }

  const Configuraciones = [
    "Inicio_Hora",
    "Fin_Hora",
    "Duracion_Default",
    "Dias_Visibles",
    "Bloques_Horarios",
    "Mostrar_Habitos_Sidebar",
    "Menu_Estilo",
    "Menu_Botones_Visibles",
    "Baul_Vista_Modo",
    "Backup_Auto_Activo",
    "Tareas_Vista_Memoria"
  ];
  for (const Clave of Configuraciones) {
    assert.match(
      Codigo_Estado,
      new RegExp(`\\b${Clave}\\b`)
    );
    assert.match(
      Codigo_Carga,
      new RegExp(`\\b${Clave}\\b`)
    );
  }
  assert.ok(
    (
      Codigo_Login.match(
        /Confirmar_Datos_Locales:\s*true/g
      ) || []
    ).length >= 2
  );
  assert.match(
    Codigo_Login,
    /const Sync_Timeout_Consulta_Ms = 45000;/
  );
  assert.match(Codigo_Login, /Persistir_Estado_Local_Seguro/);
  assert.match(Codigo_Login, /Combinar_Estados_Concurrentes/);
  assert.match(Codigo_Login, /aplicar_estado_usuario_web/);
  assert.match(Codigo_Login, /window\.addEventListener\("online"/);
  assert.doesNotMatch(Codigo_Login, /id="Sync_Indicador"/);
  assert.doesNotMatch(Codigo_Login, /id="Sync_Reintentar_Btn"/);
  assert.doesNotMatch(Codigo_Login, /Sync_Reintento_Max_Intentos/);
  assert.doesNotMatch(Codigo_Login, /"sync\.guardando":/);
  assert.doesNotMatch(Codigo_Login, /"sync\.pendiente":/);
  assert.doesNotMatch(Codigo_Login, /"sync\.guardado":/);
  assert.ok(
    (
      Codigo_Login.match(
        /Aplicar_Timeout_Consulta_Sync\(/g
      ) || []
    ).length >= 4
  );
});
