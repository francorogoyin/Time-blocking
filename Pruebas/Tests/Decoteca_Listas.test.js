const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const Ruta_Login = path.resolve(__dirname, "../../login.html");
const Codigo_Login = fs.readFileSync(Ruta_Login, "utf8");

function Extraer_Funcion(Nombre) {
  const Inicio = Codigo_Login.indexOf(`function ${Nombre}(`);
  assert.notEqual(Inicio, -1, `No se encontro ${Nombre}`);
  const Fin_Parametros = Codigo_Login.indexOf(") {", Inicio);
  assert.notEqual(Fin_Parametros, -1);
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

function Crear_Entorno_Decoteca() {
  const Contexto = { Decoteca: {} };
  vm.createContext(Contexto);
  [
    "Crear_Id_Decoteca_Lista",
    "Decoteca_Normalizar_Lista_Personalizada",
    "Decoteca_Normalizar_Listas_Personalizadas",
    "Decoteca_Id_Lista_Filtro",
    "Decoteca_Id_Lista_Desde_Filtro",
    "Decoteca_Lista_Personalizada_Por_Id",
    "Decoteca_Obra_Esta_En_Lista_Personalizada",
    "Decoteca_Orden_Obra_En_Lista_Personalizada",
    "Decoteca_Actualizar_Listas_De_Obra"
  ].forEach((Nombre) => {
    vm.runInContext(Extraer_Funcion(Nombre), Contexto);
  });
  return Contexto;
}

test("normaliza listas por teca sin duplicar obras", () => {
  const Contexto = Crear_Entorno_Decoteca();
  const Obras = [
    { Id: "libro_1", Teca_Id: "Biblioteca" },
    { Id: "libro_2", Teca_Id: "Biblioteca" },
    { Id: "album_1", Teca_Id: "Musicoteca" }
  ];
  const Listas = Contexto.Decoteca_Normalizar_Listas_Personalizadas(
    [
      {
        Id: "diciembre",
        Teca_Id: "Biblioteca",
        Nombre: "Diciembre",
        Obras: ["libro_2", "libro_1", "libro_2", "album_1"]
      },
      {
        Id: "musica",
        Teca_Id: "Musicoteca",
        Nombre: "Novedades",
        Obra_Ids: ["album_1"]
      }
    ],
    ["Biblioteca", "Musicoteca"],
    Obras
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(Listas)),
    [
      {
        Id: "diciembre",
        Teca_Id: "Biblioteca",
        Nombre: "Diciembre",
        Orden: 1,
        Obras: ["libro_2", "libro_1"]
      },
      {
        Id: "musica",
        Teca_Id: "Musicoteca",
        Nombre: "Novedades",
        Orden: 2,
        Obras: ["album_1"]
      }
    ]
  );
});

test("resuelve pertenencia y orden propio de cada lista", () => {
  const Contexto = Crear_Entorno_Decoteca();
  Contexto.Decoteca.Listas_Personalizadas = [
    { Id: "diciembre", Obras: ["libro_2", "libro_1"] },
    { Id: "enero", Obras: ["libro_1"] }
  ];

  assert.equal(
    Contexto.Decoteca_Id_Lista_Desde_Filtro(
      Contexto.Decoteca_Id_Lista_Filtro("diciembre")
    ),
    "diciembre"
  );
  assert.equal(
    Contexto.Decoteca_Obra_Esta_En_Lista_Personalizada(
      "libro_2",
      "diciembre"
    ),
    true
  );
  assert.equal(
    Contexto.Decoteca_Orden_Obra_En_Lista_Personalizada(
      "libro_1",
      "diciembre"
    ),
    1
  );
  assert.equal(
    Contexto.Decoteca_Orden_Obra_En_Lista_Personalizada(
      "libro_2",
      "enero"
    ),
    Number.MAX_SAFE_INTEGER
  );
});

test("guarda pertenencias múltiples sin tocar otras tecas", () => {
  const Contexto = Crear_Entorno_Decoteca();
  Contexto.Decoteca.Listas_Personalizadas = [
    {
      Id: "filosofia",
      Teca_Id: "Biblioteca",
      Obras: ["libro_1", "libro_2"]
    },
    {
      Id: "releer",
      Teca_Id: "Biblioteca",
      Obras: ["libro_2"]
    },
    {
      Id: "novedades",
      Teca_Id: "Musicoteca",
      Obras: ["album_1"]
    }
  ];

  Contexto.Decoteca_Actualizar_Listas_De_Obra(
    "libro_1",
    "Biblioteca",
    ["releer"]
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(Contexto.Decoteca.Listas_Personalizadas)),
    [
      {
        Id: "filosofia",
        Teca_Id: "Biblioteca",
        Obras: ["libro_2"]
      },
      {
        Id: "releer",
        Teca_Id: "Biblioteca",
        Obras: ["libro_2", "libro_1"]
      },
      {
        Id: "novedades",
        Teca_Id: "Musicoteca",
        Obras: ["album_1"]
      }
    ]
  );
});
