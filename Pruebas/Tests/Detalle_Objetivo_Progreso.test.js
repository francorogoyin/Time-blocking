const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const Ruta_Login = path.resolve(__dirname, "../../login.html");
const Codigo_Login = fs.readFileSync(Ruta_Login, "utf8");

function Extraer_Funcion(Nombre) {
  const Inicio = Codigo_Login.indexOf(`function ${Nombre}(`);
  assert.notEqual(Inicio, -1, `No se encontró la función ${Nombre}`);
  const Fin_Parametros = Codigo_Login.indexOf(") {", Inicio);
  assert.notEqual(
    Fin_Parametros,
    -1,
    `No se encontró el cuerpo de ${Nombre}`
  );
  const Inicio_Cuerpo = Fin_Parametros + 2;
  let Profundidad = 0;
  for (let Indice = Inicio_Cuerpo; Indice < Codigo_Login.length; Indice += 1) {
    if (Codigo_Login[Indice] === "{") Profundidad += 1;
    if (Codigo_Login[Indice] === "}") Profundidad -= 1;
    if (Profundidad === 0) {
      return Codigo_Login.slice(Inicio, Indice + 1);
    }
  }
  throw new Error(`La función ${Nombre} quedó incompleta`);
}

function Cargar_Funciones(Contexto, Nombres) {
  vm.createContext(Contexto);
  Nombres.forEach((Nombre) => {
    vm.runInContext(Extraer_Funcion(Nombre), Contexto);
  });
  return Contexto;
}

test("separa meta global, cuota, compromiso y trabajo operativo", () => {
  const Canonico = {
    Id: "Meta",
    Nombre: "Objetivo abstracto",
    Target_Total: 40,
    Progreso_Total: 5
  };
  const Periodo = {
    Id: "Trimestre_3",
    Inicio: "2026-07-01",
    Fin: "2026-09-30"
  };
  const Subs = Array.from({ length: 10 }, (_, Indice) => ({
    Id: `Sub_${Indice + 1}`,
    Hecha: Indice < 5,
    Aporte_Meta: 1
  }));
  const Items_Por_Id = new Map(Subs.map((Sub) => [Sub.Id, {
    Sub,
    Padre_Id: ""
  }]));
  const Modelo = { Objetivos: { Meta: Canonico }, Periodos: {} };
  const Contexto = {
    Asegurar_Modelo_Planes: () => Modelo,
    Planes_Objetivo_Canonico_Contextual: () => Canonico,
    Planes_Periodo_Contexto_Objetivo: () => Periodo,
    Planes_Subobjetivos_Contexto_Objetivo: () => ({
      Items: Subs,
      Items_Por_Id
    }),
    Planes_Target_Suma_Componentes_Activo: () => false,
    Planes_Estado_Normalizado_Subobjetivo: (Sub) =>
      Sub.Hecha ? "Cumplido" : "Activo",
    Planes_Aporte_Meta_Efectivo: (Sub) => Sub.Aporte_Meta,
    Planes_Compromiso_Objetivo_En_Periodo: () => ({
      Total: 10,
      Realizado: 5,
      Cumplidos: Subs.slice(0, 5)
    }),
    Planes_Target_Contextual_Objetivo: () => 7.5,
    Planes_Avance_Real_Objetivo_En_Periodo: () => 5,
    Planes_Carga_Trabajo_Objetivo: () => ({
      Calculable: true,
      Total: 10000,
      Realizado: 1000,
      Pendiente: 9000,
      Unidad: "páginas"
    }),
    Planes_Progreso_Total_Objetivo_Efectivo: () => 5
  };
  Cargar_Funciones(Contexto, [
    "Planes_Metrica_Progreso",
    "Planes_Aporte_Cumplido_Para_Resumen",
    "Planes_Resumen_Progreso_Objetivo"
  ]);
  const Resultado = Contexto.Planes_Resumen_Progreso_Objetivo({
    Id: "Meta",
    __Objetivo_Canonico_Id: "Meta",
    Target_Total: 7.5
  });
  assert.equal(Resultado.Global.Porcentaje, 12.5);
  assert.ok(Math.abs(Resultado.Cuota.Porcentaje - 66.6666667) < 0.0001);
  assert.equal(Resultado.Compromiso.Porcentaje, 50);
  assert.equal(Resultado.Trabajo.Porcentaje, 10);
  assert.equal(Resultado.Compromiso.Pendiente, 5);
  assert.equal(Resultado.Trabajo.Pendiente, 9000);
});

test("la semana separa cuota y registros reales de la meta anual", () => {
  const Canonico = {
    Id: "Lectofilia",
    Target_Total: 40
  };
  const Periodo = {
    Id: "Semana_34",
    Tipo: "Semana",
    Inicio: "2026-08-17",
    Fin: "2026-08-23"
  };
  const Sub = { Id: "Sub", Target_Total: 1 };
  const Contexto = {
    Asegurar_Modelo_Planes: () => ({
      Objetivos: { Lectofilia: Canonico },
      Periodos: { Semana_34: Periodo }
    }),
    Planes_Objetivo_Canonico_Contextual: () => Canonico,
    Planes_Periodo_Contexto_Objetivo: () => Periodo,
    Planes_Subobjetivos_Contexto_Objetivo: () => ({
      Items: [Sub],
      Items_Por_Id: new Map([[Sub.Id, { Sub, Padre_Id: "" }]])
    }),
    Planes_Target_Suma_Componentes_Activo: () => false,
    Planes_Estado_Normalizado_Subobjetivo: () => "Activo",
    Planes_Compromiso_Objetivo_En_Periodo: () => ({
      Total: 1.25,
      Realizado: 0.125,
      Cumplidos: []
    }),
    Planes_Target_Contextual_Objetivo: () => 0.77,
    Planes_Avance_Real_Objetivo_En_Periodo: () => 2,
    Planes_Carga_Trabajo_Objetivo: () => ({
      Calculable: true,
      Total: 50,
      Realizado: 12,
      Pendiente: 38,
      Unidad: "páginas"
    }),
    Planes_Progreso_Total_Objetivo_Efectivo: () => 27.57,
    Planes_Metrica_Progreso: (Realizado, Total) => ({
      Realizado,
      Total,
      Pendiente: Math.max(0, Total - Realizado),
      Porcentaje: Total > 0 ? Realizado / Total * 100 : 0
    })
  };
  Cargar_Funciones(Contexto, [
    "Planes_Resumen_Progreso_Objetivo"
  ]);
  const Resultado = Contexto.Planes_Resumen_Progreso_Objetivo({
    Id: "Lectofilia",
    __Objetivo_Canonico_Id: "Lectofilia",
    __Periodo_Contexto_Id: "Semana_34",
    __Plan_Proyectado: true,
    Target_Total: 0.77
  });
  assert.equal(Resultado.Cuota.Realizado, 2);
  assert.equal(Resultado.Cuota.Total, 0.77);
  assert.equal(Resultado.Compromiso.Realizado, 0.125);
  assert.equal(Resultado.Compromiso.Total, 1.25);
  assert.equal(Resultado.Trabajo.Realizado, 12);
});

test("no cuenta como compromiso las divisiones internas anidadas", () => {
  const Raiz = { Id: "Resultado", Hecha: true, Aporte_Meta: 1 };
  const Parte = { Id: "Parte", Hecha: true, Aporte_Meta: 0 };
  const Subs = [Raiz, Parte];
  const Modelo = { Objetivos: {}, Periodos: {} };
  const Contexto = {
    Asegurar_Modelo_Planes: () => Modelo,
    Planes_Objetivo_Canonico_Contextual: (Objetivo) => Objetivo,
    Planes_Periodo_Contexto_Objetivo: () => null,
    Planes_Subobjetivos_Contexto_Objetivo: () => ({
      Items: Subs,
      Items_Por_Id: new Map([
        [Raiz.Id, { Sub: Raiz, Padre_Id: "" }],
        [Parte.Id, { Sub: Parte, Padre_Id: Raiz.Id }]
      ])
    }),
    Planes_Target_Suma_Componentes_Activo: (Sub) => Sub.Id === Raiz.Id,
    Planes_Estado_Normalizado_Subobjetivo: () => "Cumplido",
    Planes_Aporte_Meta_Efectivo: (Sub) => Sub.Aporte_Meta,
    Planes_Avance_Real_Objetivo_En_Periodo: () => 0,
    Planes_Carga_Trabajo_Objetivo: () => ({ Calculable: false }),
    Planes_Progreso_Total_Objetivo_Efectivo: () => 1
  };
  Cargar_Funciones(Contexto, [
    "Planes_Metrica_Progreso",
    "Planes_Aporte_Cumplido_Para_Resumen",
    "Planes_Resumen_Progreso_Objetivo"
  ]);
  const Resultado = Contexto.Planes_Resumen_Progreso_Objetivo({
    Id: "Meta",
    Target_Total: 1
  });
  assert.equal(Resultado.Compromisos.length, 1);
  assert.equal(Resultado.Cumplidos.length, 1);
  assert.equal(Resultado.Compromiso.Porcentaje, 100);
});

test("usa el avance del período aunque los subobjetivos no tengan target", () => {
  const Objetivo = {
    Id: "Texturas",
    Target_Total: 40000,
    Progreso_Total: 21665
  };
  const Subs = Array.from({ length: 10 }, (_, Indice) => ({
    Id: `Cuento_${Indice + 1}`,
    Aporte_Meta: 1
  }));
  const Contexto = {
    Asegurar_Modelo_Planes: () => ({ Objetivos: { Texturas: Objetivo } }),
    Planes_Objetivo_Canonico_Contextual: () => Objetivo,
    Planes_Periodo_Contexto_Objetivo: () => ({ Id: "Trimestre" }),
    Planes_Subobjetivos_Contexto_Objetivo: () => ({
      Items: Subs,
      Items_Por_Id: new Map(Subs.map((Sub) => [Sub.Id, {
        Sub,
        Padre_Id: ""
      }]))
    }),
    Planes_Estado_Normalizado_Subobjetivo: () => "Activo",
    Planes_Aporte_Cumplido_Para_Resumen: () => 0,
    Planes_Compromiso_Objetivo_En_Periodo: () => ({
      Total: 10,
      Realizado: 0,
      Cumplidos: []
    }),
    Planes_Target_Contextual_Objetivo: () => 40000,
    Planes_Avance_Real_Objetivo_En_Periodo: () => 21665,
    Planes_Progreso_Total_Objetivo_Efectivo: () => 21665,
    Planes_Carga_Trabajo_Objetivo: () => ({ Calculable: false }),
    Planes_Metrica_Progreso: (Realizado, Total) => ({
      Porcentaje: Total > 0 ? (Realizado / Total) * 100 : 0
    })
  };
  Cargar_Funciones(Contexto, [
    "Planes_Resumen_Progreso_Objetivo"
  ]);
  const Resultado = Contexto.Planes_Resumen_Progreso_Objetivo(Objetivo);
  assert.equal(Resultado.Cuota.Porcentaje, 54.1625);
});

test("conserva realizado manual en subobjetivos sin target", () => {
  const Sub = {
    Id: "Cuento_1",
    Target_Total: 0,
    Hecha: true,
    Estado: "Cumplido"
  };
  const Contexto = {
    Planes_Total_Avances_Subobjetivo: () => 0,
    Planes_Aplicar_Fecha_Final_Subobjetivo: () => {},
    Planes_Sincronizar_Estado_Familia_Subobjetivo: () => {}
  };
  Cargar_Funciones(Contexto, [
    "Planes_Recalcular_Progreso_Subobjetivo"
  ]);
  Contexto.Planes_Recalcular_Progreso_Subobjetivo(Sub, {});
  assert.equal(Sub.Hecha, true);
  assert.equal(Sub.Estado, "Cumplido");
});

test("el sincronizador no desmarca familias cualitativas realizadas", () => {
  const Sub = {
    Id: "Cuento_1",
    Hecha: true,
    Estado: "Cumplido",
    Fecha_Fin: "2026-08-10"
  };
  const Modelo = { Subobjetivos: { "Cuento_1": Sub } };
  const Contexto = {
    Asegurar_Modelo_Planes: () => Modelo,
    Planes_Subobjetivos_Familia_Ids: () => new Set(["Cuento_1"]),
    Planes_Total_Avances_Subobjetivo: () => 0,
    Planes_Ultimo_Avance_Subobjetivo: () => null
  };
  Cargar_Funciones(Contexto, [
    "Planes_Sincronizar_Estado_Familia_Subobjetivo"
  ]);
  Contexto.Planes_Sincronizar_Estado_Familia_Subobjetivo(
    "Cuento_1",
    Modelo
  );
  assert.equal(Sub.Hecha, true);
  assert.equal(Sub.Estado, "Cumplido");
  assert.equal(Sub.Fecha_Fin, "2026-08-10");
});

test("muestra el exceso real y limita solamente la barra visual", () => {
  const Contexto = {};
  Cargar_Funciones(Contexto, ["Planes_Metrica_Progreso"]);
  const Resultado = Contexto.Planes_Metrica_Progreso(125, 100);
  assert.equal(Resultado.Porcentaje, 125);
  assert.equal(Resultado.Barra, 100);
  assert.equal(Resultado.Pendiente, 0);
});

test("agrega avances de partes e hijos en el trabajo contextual", () => {
  const Contexto = {
    Asegurar_Modelo_Planes: () => ({
      Partes: {
        Parte_Raiz: { Id: "Parte_Raiz", Subobjetivo_Id: "Raiz" },
        Parte_Hija: { Id: "Parte_Hija", Subobjetivo_Id: "Hija" }
      },
      Avances: {
        Avance_Raiz: {
          Subobjetivo_Id: "Raiz",
          Fecha: "2026-08-10",
          Unidad: "Páginas",
          Cantidad: 10
        },
        Avance_Hija: {
          Subobjetivo_Id: "Hija",
          Fecha: "2026-08-12",
          Unidad: "Páginas",
          Cantidad: 15
        },
        Avance_Parte: {
          Parte_Id: "Parte_Hija",
          Fecha: "2026-08-13",
          Unidad: "Páginas",
          Cantidad: 20
        },
        Avance_Fuera: {
          Subobjetivo_Id: "Hija",
          Fecha: "2026-10-01",
          Unidad: "Páginas",
          Cantidad: 50
        }
      }
    }),
    Planes_Subobjetivos_Familia_Ids: () => new Set(["Raiz", "Hija"]),
    Planes_Fecha_Avance_Plan: (Avance) => Avance.Fecha,
    Planes_Normalizar_Clave_Unidad_Ritmo: (Unidad) =>
      Unidad.toLocaleLowerCase()
  };
  Cargar_Funciones(Contexto, ["Planes_Avances_Carga_Subobjetivo"]);
  const Total = Contexto.Planes_Avances_Carga_Subobjetivo(
    { Id: "Raiz" },
    { Unidad_Clave: "páginas" },
    "2026-07-01",
    "2026-09-30"
  );
  assert.equal(Total, 45);
});

test("un exceso interno no compensa otro resultado pendiente", () => {
  const Contexto = {
    Asegurar_Modelo_Planes: () => ({}),
    Planes_Estado_Normalizado_Subobjetivo: () => "Cumplido",
    Planes_Aporte_Meta_Efectivo: () => 150
  };
  Cargar_Funciones(Contexto, [
    "Planes_Aporte_Cumplido_Para_Resumen"
  ]);
  const Resultado = Contexto.Planes_Aporte_Cumplido_Para_Resumen({
    Hecha: true,
    Aporte_Meta_Automatico: true,
    Target_Total: 100
  });
  assert.equal(Resultado, 100);
});

test("la fecha real no reemplaza el período comprometido", () => {
  const Contexto = {
    Planes_Normalizar_Fecha_Comparacion: (Fecha) => Fecha,
    Planes_Rango_Item_Fechado: () => ({
      Inicio: "2026-06-15",
      Fin: "2026-06-15"
    })
  };
  Cargar_Funciones(Contexto, ["Planes_Rango_Planeado_Item"]);
  const Resultado = Contexto.Planes_Rango_Planeado_Item({
    Fecha_Objetivo: "2026-09-30",
    Fecha_Fin: "2026-06-15"
  });
  assert.equal(Resultado.Inicio, "2026-09-30");
  assert.equal(Resultado.Fin, "2026-09-30");
});

test("oculta la pauta ampliada cuando el hábito ya está asociado", () => {
  const Contexto = {
    Planes_Vinculo_Ritmo_Habito: () => ({
      Habito: { Id: "Habito_Leer", Nombre: "Leer" }
    })
  };
  Cargar_Funciones(Contexto, ["Planes_Render_Pauta_Hoy_Objetivo"]);
  assert.equal(
    Contexto.Planes_Render_Pauta_Hoy_Objetivo({ Id: "Meta" }),
    ""
  );
});

test("resume la cuota completa por día activo incluso en un descanso", () => {
  const Contexto = {
    Planes_Vinculo_Ritmo_Habito: () => ({
      Habito: { Id: "Habito_Leer", Nombre: "Leer" }
    }),
    Planes_Calcular_Ritmo_Meta: () => ({
      Calculable: true,
      Completa: false,
      Es_Hoy_Valido: false,
      Cantidad_Hoy: 0,
      Cuota_Diaria_Total: 204.55,
      Dias_Validos_Restantes: 44,
      Carga: { Unidad: "páginas" }
    })
  };
  Cargar_Funciones(Contexto, ["Planes_Ritmo_Dia_Activo_Objetivo"]);
  const Resultado = Contexto.Planes_Ritmo_Dia_Activo_Objetivo({
    Id: "Meta"
  });
  assert.equal(Resultado.Cantidad, 204.55);
  assert.equal(Resultado.Unidad, "páginas");
  assert.equal(
    Contexto.Planes_Ritmo_Dia_Activo_Objetivo({
      Id: "Meta",
      Pausado: true
    }),
    null
  );
});

test("integra el estado sin repetir el encabezado explicativo", () => {
  assert.doesNotMatch(
    Codigo_Login,
    /<header class="Planes_Progreso_Encabezado"/
  );
  assert.match(Codigo_Login, /class="Planes_Meta_Madre_Identidad"/);
  assert.match(
    Codigo_Login,
    /class="Planes_Progreso_Estado\$\{Estado_Clase\}"/
  );
});

test("nombra el horizonte de la meta madre y no el período visible", () => {
  let Tipo_Base = "Anio";
  const Etiquetas = {
    "planes.horizonte_anual": "Anual",
    "planes.horizonte_semestral": "Semestral",
    "planes.horizonte_personalizado": "Personalizado",
    "planes.avance_global": "Avance global"
  };
  const Contexto = {
    Planes_Periodo_Base_Objetivo: () => ({ Tipo: Tipo_Base }),
    t: (Clave) => Etiquetas[Clave] || Clave
  };
  Cargar_Funciones(Contexto, ["Planes_Horizonte_Objetivo_Label"]);
  assert.equal(
    Contexto.Planes_Horizonte_Objetivo_Label({
      Periodo_Id: "Anio_2026",
      __Periodo_Contexto_Id: "Trimestre_3"
    }),
    "Anual"
  );
  Tipo_Base = "Semestre";
  assert.equal(
    Contexto.Planes_Horizonte_Objetivo_Label({ Periodo_Id: "Semestre_1" }),
    "Semestral"
  );
  Tipo_Base = "Custom";
  assert.equal(
    Contexto.Planes_Horizonte_Objetivo_Label({ Periodo_Id: "Propio" }),
    "Personalizado"
  );
  Tipo_Base = "Desconocido";
  assert.equal(
    Contexto.Planes_Horizonte_Objetivo_Label({ Periodo_Id: "Raro" }),
    "Avance global"
  );
});

test("trabajo operativo no repite realizado ni una descripción vacía", () => {
  assert.doesNotMatch(Codigo_Login, /planes\.trabajo_realizado/);
  assert.doesNotMatch(Codigo_Login, /planes\.trabajo_operativo_desc/);
  const Contexto = {
    Escape_Html: (Valor) => String(Valor ?? ""),
    Planes_Formatear_Porcentaje_Resumen: (Valor) => String(Valor),
    Planes_Formatear_Numero_Texto: (Valor) => String(Valor),
    Planes_Formatear_Numero: (Valor) => String(Valor),
    t: (Clave, Datos) => Clave === "planes.progreso_de"
      ? `${Datos.Realizado} de ${Datos.Total} ${Datos.Unidad}`
      : Clave
  };
  Cargar_Funciones(Contexto, ["Planes_Render_Indicador_Progreso"]);
  const Html = Contexto.Planes_Render_Indicador_Progreso({
    Clave: "trabajo",
    Clase: "Trabajo",
    Etiqueta: "Trabajo operativo",
    Descripcion: "",
    Texto_Sin_Datos: "Sin datos",
    Unidad: "páginas",
    Metrica: {
      Calculable: true,
      Porcentaje: 50,
      Barra: 50,
      Realizado: 50,
      Total: 100
    },
    Desglose: [
      { Clase: "Pendiente", Texto: "Pendiente: 50 páginas" }
    ]
  });
  assert.match(Html, /50 de 100 páginas/);
  assert.match(Html, /Pendiente: 50 páginas/);
  assert.doesNotMatch(Html, /Planes_Progreso_Descripcion/);
});

test("el editor comparte la cuota visible con la pauta del día", () => {
  assert.match(Codigo_Login, /const Cuota_Visible = Info_Visible\.Calculable/);
  assert.match(Codigo_Login, /Planes_Formatear_Numero\(Cuota_Visible\)/);
  assert.match(
    Codigo_Login,
    /Planes_Formatear_Numero_Texto\(Cuota_Visible\)/
  );
});

test("al borrar un hábito se eliminan sus pautas fijadas", () => {
  assert.match(
    Codigo_Login,
    /Object\.values\(Modelo\.Objetivos \|\| \{\}\)\.forEach\(\(Objetivo\) =>/
  );
  assert.match(Codigo_Login, /Ritmo_Diario_Historial = Object\.fromEntries\(/);
  assert.match(Codigo_Login, /Registro\?\.Habito_Id !== Habito_Id/);
});

test("la fila colapsada usa la cuota semanal y no la meta anual", () => {
  const Contexto = {
    Obtener_Locale_Actual: () => "es-AR",
    Planes_Resumen_Progreso_Objetivo: () => ({
      Canonico: {
        Unidad: "Libros",
        Target_Total: 40
      },
      Periodo: {
        Id: "Semana_28",
        Tipo: "Semana"
      },
      Global: {
        Calculable: true,
        Total: 40,
        Realizado: 27.57,
        Pendiente: 12.43
      },
      Cuota: {
        Calculable: true,
        Total: 0.77,
        Realizado: 0,
        Pendiente: 0.77
      }
    }),
    Planes_Periodo_Contexto_Objetivo: () => ({
      Id: "Semana_28",
      Tipo: "Semana"
    }),
    Planes_Periodo_Cerrado: () => true,
    Planes_Aportes_Planeados_Objetivo: () => 0,
    Planes_Normalizar_Modo_Avance: () => "Metrica",
    Planes_Unidad_Label: () => "libros",
    Planes_Formatear_Numero_Texto: (Valor) =>
      new Intl.NumberFormat("es-AR", {
        maximumFractionDigits: 2
      }).format(Number(Valor)),
    t: (Clave, Datos) => {
      if (Clave === "planes.meta_realizados") {
        return `${Datos.Cantidad} realizados`;
      }
      if (Clave === "planes.meta_faltan") {
        return `${Datos.Cantidad} faltan`;
      }
      return Clave;
    }
  };
  Cargar_Funciones(Contexto, [
    "Planes_Items_Resumen_Tarjeta_Objetivo"
  ]);
  const Items = Contexto.Planes_Items_Resumen_Tarjeta_Objetivo({
    Id: "Meta",
    Target_Total: 2.82,
    Progreso_Total: 0.57
  });
  assert.equal(
    JSON.stringify(Items.map((Item) => Item.Texto)),
    JSON.stringify([
      "0,77 libros",
      "0 realizados",
      "0,77 faltan"
    ])
  );
});
