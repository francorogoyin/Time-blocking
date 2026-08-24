const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const Ruta_Helper = path.resolve(
  __dirname,
  "../../supabase/functions/semaplan-ai/decoteca_paginacion.mjs",
);

let Seleccionar_Pagina_Decoteca;
let Construir_Obra_Compacta_Decoteca;

test.before(async () => {
  const Helper = await import(pathToFileURL(Ruta_Helper).href);
  Seleccionar_Pagina_Decoteca = Helper.Seleccionar_Pagina_Decoteca;
  Construir_Obra_Compacta_Decoteca =
    Helper.Construir_Obra_Compacta_Decoteca;
});

function Crear_Obras(Cantidad = 65) {
  return Array.from({ length: Cantidad }, (_, Indice) => ({
    Id: `obra_${String(Indice + 1).padStart(3, "0")}`,
    Teca_Id: "Biblioteca",
    Titulo: `Obra ${Indice + 1}`,
    Descripcion: Indice % 2 === 0 ? "" : `Descripcion ${Indice + 1}`,
    Orden: Indice + 1,
  }));
}

test("pagina las primeras cinco obras desde offset 0", () => {
  const Respuesta = Seleccionar_Pagina_Decoteca({
    Obras: Crear_Obras(),
    Teca_Id: "Biblioteca",
    Offset: 0,
    Limite: 5,
  });
  assert.deepEqual(
    Respuesta.Obras.map((Obra) => Obra.Id),
    ["obra_001", "obra_002", "obra_003", "obra_004", "obra_005"],
  );
  assert.equal(Respuesta.Total, 65);
  assert.equal(Respuesta.Hay_Mas, true);
  assert.equal(Respuesta.Siguiente_Offset, 5);
});

test("pagina las obras 61 a 65 sin traer las anteriores", () => {
  const Respuesta = Seleccionar_Pagina_Decoteca({
    Obras: Crear_Obras(),
    Teca_Id: "Biblioteca",
    Offset: 60,
    Limite: 5,
  });
  assert.deepEqual(
    Respuesta.Obras.map((Obra) => Obra.Id),
    ["obra_061", "obra_062", "obra_063", "obra_064", "obra_065"],
  );
  assert.equal(Respuesta.Hay_Mas, false);
  assert.equal(Respuesta.Siguiente_Offset, null);
});

test("maneja ultima pagina y offset mayor al total", () => {
  const Ultima = Seleccionar_Pagina_Decoteca({
    Obras: Crear_Obras(),
    Offset: 63,
    Limite: 5,
  });
  assert.deepEqual(
    Ultima.Obras.map((Obra) => Obra.Id),
    ["obra_064", "obra_065"],
  );
  assert.equal(Ultima.Total, 65);
  const Vacia = Seleccionar_Pagina_Decoteca({
    Obras: Crear_Obras(),
    Offset: 100,
    Limite: 5,
  });
  assert.deepEqual(Vacia.Obras, []);
  assert.equal(Vacia.Total, 65);
  assert.equal(Vacia.Hay_Mas, false);
});

test("filtra descripcion vacia antes de paginar", () => {
  const Respuesta = Seleccionar_Pagina_Decoteca({
    Obras: Crear_Obras(),
    Teca_Id: "Biblioteca",
    Filtros: { descripcion_vacia: true },
    Offset: 0,
    Limite: 5,
  });
  assert.deepEqual(
    Respuesta.Obras.map((Obra) => Obra.Id),
    ["obra_001", "obra_003", "obra_005", "obra_007", "obra_009"],
  );
  assert.equal(Respuesta.Total, 33);
});

test("mantiene orden estable para empates de Orden", () => {
  const Respuesta = Seleccionar_Pagina_Decoteca({
    Obras: [
      { Id: "obra_b", Teca_Id: "Biblioteca", Orden: 1 },
      { Id: "obra_a", Teca_Id: "Biblioteca", Orden: 1 },
      { Id: "obra_c", Teca_Id: "Biblioteca", Orden: 2 },
    ],
    Limite: 5,
  });
  assert.deepEqual(
    Respuesta.Obras.map((Obra) => Obra.Id),
    ["obra_a", "obra_b", "obra_c"],
  );
});

test("el modo compacto omite estructuras pesadas", () => {
  const Obra = {
    Id: "obra_1",
    Titulo: "Una obra",
    Descripcion: "Descripcion",
    Partes: Array.from({ length: 20 }, () => ({ texto: "parte" })),
    Metadatos: Array.from({ length: 20 }, () => ["clave", "valor"]),
    Portada_Data_Url: `data:image/png;base64,${"A".repeat(5000)}`,
  };
  const Compacta = Construir_Obra_Compacta_Decoteca(Obra);
  assert.equal(Object.prototype.hasOwnProperty.call(Compacta, "Partes"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(Compacta, "Metadatos"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(Compacta, "Portada_Data_Url"), false);
  assert.ok(
    JSON.stringify(Compacta).length <
      JSON.stringify(Obra).length / 4,
  );
});

test("el gateway expone paginacion, filtros y modo compacto en el schema", () => {
  const Ruta_Gateway = path.resolve(
    __dirname,
    "../../supabase/functions/semaplan-ai/index.ts",
  );
  const Codigo = fs.readFileSync(Ruta_Gateway, "utf8");
  assert.match(Codigo, /operationId: "semaplan_buscar_global"/);
  assert.match(Codigo, /name: "offset"/);
  assert.match(Codigo, /name: "filtros"/);
  assert.match(Codigo, /descripcion_vacia/);
  assert.match(Codigo, /name: "compacto"/);
  assert.match(Codigo, /Siguiente_Offset/);
});
