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
  assert.notEqual(Fin_Parametros, -1);
  let Profundidad = 0;
  for (let Indice = Fin_Parametros + 2; Indice < Codigo_Login.length;
    Indice += 1) {
    if (Codigo_Login[Indice] === "{") Profundidad += 1;
    if (Codigo_Login[Indice] === "}") Profundidad -= 1;
    if (Profundidad === 0) return Codigo_Login.slice(Inicio, Indice + 1);
  }
  throw new Error(`La función ${Nombre} quedó incompleta`);
}

function Crear_Contexto() {
  const Contexto = {
    Planes_Tipos: ["Anio", "Semestre", "Trimestre", "Mes", "Semana"]
  };
  vm.createContext(Contexto);
  [
    "Planes_Periodos_Destino_Agrupados",
    "Planes_Periodo_Destino_Elegido"
  ].forEach((Nombre) => {
    vm.runInContext(Extraer_Funcion(Nombre), Contexto);
  });
  return Contexto;
}

test("agrupa los destinos por año y después por capa", () => {
  const Contexto = Crear_Contexto();
  const Agrupados = Contexto.Planes_Periodos_Destino_Agrupados([
    { Id: "Sem_2027", Tipo: "Semana", Inicio: "2027-01-04" },
    { Id: "Anio_2026", Tipo: "Anio", Inicio: "2026-01-01" },
    { Id: "Mes_2026", Tipo: "Mes", Inicio: "2026-02-01" },
    { Id: "Sem_2026", Tipo: "Semana", Inicio: "2026-01-04" }
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(Agrupados)), [
    {
      Anio: "2026",
      Tipos: [
        {
          Tipo: "Anio",
          Periodos: [{ Id: "Anio_2026", Tipo: "Anio", Inicio: "2026-01-01" }]
        },
        {
          Tipo: "Mes",
          Periodos: [{ Id: "Mes_2026", Tipo: "Mes", Inicio: "2026-02-01" }]
        },
        {
          Tipo: "Semana",
          Periodos: [{ Id: "Sem_2026", Tipo: "Semana", Inicio: "2026-01-04" }]
        }
      ]
    },
    {
      Anio: "2027",
      Tipos: [
        {
          Tipo: "Semana",
          Periodos: [{ Id: "Sem_2027", Tipo: "Semana", Inicio: "2027-01-04" }]
        }
      ]
    }
  ]);
});

test("devuelve un período futuro creado para la selección", () => {
  const Contexto = Crear_Contexto();
  const Periodo_Futuro = {
    Id: "Semana_2027_02",
    Tipo: "Semana",
    Inicio: "2027-01-11",
    Fin: "2027-01-17"
  };
  const Resultado = Contexto.Planes_Periodo_Destino_Elegido(
    [Periodo_Futuro],
    Periodo_Futuro.Id
  );

  assert.deepEqual(JSON.parse(JSON.stringify(Resultado)), Periodo_Futuro);
});
