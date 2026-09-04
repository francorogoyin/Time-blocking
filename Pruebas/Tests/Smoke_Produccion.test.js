const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const Origen = "https://semaplan.com";
const Version_Actual = "1.16.1";

async function Descargar_Texto(Ruta) {
  const Url = new URL(Ruta, Origen);
  Url.searchParams.set(
    "smoke",
    String(Date.now())
  );
  const Respuesta = await fetch(Url, {
    headers: {
      "cache-control": "no-cache"
    }
  });
  assert.equal(
    Respuesta.status,
    200,
    `${Url.pathname} no respondio correctamente`
  );
  return await Respuesta.text();
}

function Hash_Sha256(Texto) {
  return crypto
    .createHash("sha256")
    .update(Texto)
    .digest("hex");
}

function Normalizar_Respuesta_Cloudflare(Texto) {
  return Texto.replace(
    /r:'[a-f\d]+',t:'[^']+'/gi,
    "r:'<request>',t:'<timestamp>'"
  );
}

test("produccion sirve el frontend y release actuales", async () => {
  const [Login, Release] = await Promise.all([
    Descargar_Texto("/login.html"),
    Descargar_Texto(
      `/Semaplan_Version_${Version_Actual.replaceAll(".", "_")}.html`
    )
  ]);

  assert.match(
    Login,
    new RegExp(
      `Version_Programa_Actual = "${Version_Actual.replaceAll(".", "\\.")}"`
    )
  );
  assert.match(Login, /aplicar_estado_usuario_web/);
  assert.match(Login, /Base_Sync_DB_Nombre/);
  assert.equal(
    Hash_Sha256(Normalizar_Respuesta_Cloudflare(Login)),
    Hash_Sha256(Normalizar_Respuesta_Cloudflare(Release))
  );
});

test("produccion bloquea releases obsoletos", async () => {
  const Manifest = JSON.parse(
    await Descargar_Texto(
      "/Aplicaciones/Web_Versiones/Manifest_Versiones.json"
    )
  );
  const Actual = Manifest.find((Item) => {
    return Item.Id === Version_Actual;
  });
  assert.equal(Actual?.Estado, "stable");
  assert.equal(Actual?.Archivo, "Semaplan_Version_1_16_1.html");
  assert.equal(Actual?.Esquema_Estado_Min, 14);
  assert.equal(Actual?.Esquema_Estado_Max, 14);
});
