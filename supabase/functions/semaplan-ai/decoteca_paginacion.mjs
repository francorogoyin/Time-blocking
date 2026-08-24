function Normalizar_Texto_Paginacion(Valor) {
  return String(Valor ?? "").trim();
}

function Normalizar_Busqueda_Paginacion(Valor) {
  return Normalizar_Texto_Paginacion(Valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function Es_Campo_Vacio_Paginacion(Valor) {
  if (Valor == null) return true;
  if (typeof Valor === "string") {
    return Valor.trim() === "";
  }
  if (Array.isArray(Valor)) {
    return Valor.length === 0;
  }
  return false;
}

function Valor_Obra_Paginacion(Obra, ...Claves) {
  for (const Clave of Claves) {
    if (Object.prototype.hasOwnProperty.call(Obra, Clave)) {
      return Obra[Clave];
    }
  }
  return undefined;
}

function Filtro_Vacio_Paginacion(Obra, Filtros, Clave, ...Campos) {
  if (Filtros[Clave] !== true) return true;
  return Es_Campo_Vacio_Paginacion(
    Valor_Obra_Paginacion(Obra, ...Campos),
  );
}

function Filtro_Valor_Paginacion(Obra, Filtros, Clave, ...Campos) {
  const Filtro = Filtros[Clave];
  if (Filtro == null || Filtro === "") return true;
  const Valores = Array.isArray(Filtro) ? Filtro : [Filtro];
  const Obra_Normalizada = Normalizar_Busqueda_Paginacion(
    Valor_Obra_Paginacion(Obra, ...Campos),
  );
  return Valores.some((Valor) =>
    Normalizar_Busqueda_Paginacion(Valor) === Obra_Normalizada
  );
}

function Obra_Coincide_Filtros_Paginacion(Obra, Filtros = {}) {
  if (!Filtro_Vacio_Paginacion(
    Obra,
    Filtros,
    "descripcion_vacia",
    "Descripcion",
    "descripcion",
  )) return false;
  if (!Filtro_Vacio_Paginacion(
    Obra,
    Filtros,
    "creador_vacio",
    "Creador",
    "creador",
  )) return false;
  if (!Filtro_Vacio_Paginacion(
    Obra,
    Filtros,
    "anio_vacio",
    "Anio",
    "anio",
  )) return false;
  if (!Filtro_Vacio_Paginacion(
    Obra,
    Filtros,
    "genero_vacio",
    "Genero",
    "genero",
  )) return false;
  if (!Filtro_Vacio_Paginacion(
    Obra,
    Filtros,
    "subgenero_vacio",
    "Subgenero",
    "subgenero",
  )) return false;

  if (Filtros.portada_vacia === true) {
    const Tiene_Portada = [
      Valor_Obra_Paginacion(Obra, "Portada_Url", "portada_url"),
      Valor_Obra_Paginacion(
        Obra,
        "Portada_Data_Url",
        "Portada_Data",
        "portada_data_url",
        "portada_data",
      ),
    ].some((Valor) => !Es_Campo_Vacio_Paginacion(Valor));
    if (Tiene_Portada) return false;
  }

  if (Filtros.total_unidades_cero === true) {
    const Datos_Teca = Valor_Obra_Paginacion(
      Obra,
      "Datos_Teca",
      "datos_teca",
    );
    const Total = Valor_Obra_Paginacion(
      Obra,
      "Total_Unidades",
      "total_unidades",
    ) ?? (Datos_Teca && typeof Datos_Teca === "object"
      ? Valor_Obra_Paginacion(
        Datos_Teca,
        "Total_Unidades",
        "total_unidades",
      )
      : undefined);
    if (Number(Total || 0) !== 0) return false;
  }

  return Filtro_Valor_Paginacion(
    Obra,
    Filtros,
    "estado",
    "Estado",
    "estado",
  ) && Filtro_Valor_Paginacion(
    Obra,
    Filtros,
    "periodo",
    "Periodo",
    "periodo",
  ) && Filtro_Valor_Paginacion(
    Obra,
    Filtros,
    "prioridad",
    "Prioridad",
    "prioridad",
  );
}

function Ordenar_Obras_Decoteca_Paginacion(Obras) {
  return Obras
    .map((Obra, Indice) => ({ Obra, Indice }))
    .sort((A, B) => {
      const Orden_A = Number(A.Obra.Orden ?? A.Obra.orden);
      const Orden_B = Number(B.Obra.Orden ?? B.Obra.orden);
      const Tiene_Orden_A = Number.isFinite(Orden_A);
      const Tiene_Orden_B = Number.isFinite(Orden_B);
      if (Tiene_Orden_A && Tiene_Orden_B && Orden_A !== Orden_B) {
        return Orden_A - Orden_B;
      }
      if (Tiene_Orden_A !== Tiene_Orden_B) {
        return Tiene_Orden_A ? -1 : 1;
      }
      const Id_A = Normalizar_Texto_Paginacion(
        A.Obra.Id ?? A.Obra.id,
      );
      const Id_B = Normalizar_Texto_Paginacion(
        B.Obra.Id ?? B.Obra.id,
      );
      if (Id_A < Id_B) return -1;
      if (Id_A > Id_B) return 1;
      return A.Indice - B.Indice;
    })
    .map(({ Obra }) => Obra);
}

export function Seleccionar_Pagina_Decoteca({
  Obras,
  Teca_Id = "",
  Filtros = {},
  Offset = 0,
  Limite = 30,
}) {
  const Candidatas = Ordenar_Obras_Decoteca_Paginacion(
    Obras.filter((Obra) => {
      if (
        Teca_Id &&
        Normalizar_Texto_Paginacion(Obra.Teca_Id ?? Obra.teca_id) !== Teca_Id
      ) return false;
      return Obra_Coincide_Filtros_Paginacion(Obra, Filtros);
    }),
  );
  const Total = Candidatas.length;
  const Inicio = Math.max(0, Math.floor(Number(Offset) || 0));
  const Tamano = Math.max(1, Math.floor(Number(Limite) || 1));
  const Resultados = Candidatas.slice(Inicio, Inicio + Tamano);
  const Hay_Mas = Inicio + Resultados.length < Total;
  return {
    Obras: Resultados,
    Total,
    Offset: Inicio,
    Limite: Tamano,
    Hay_Mas,
    Siguiente_Offset: Hay_Mas ? Inicio + Resultados.length : null,
  };
}

export function Construir_Obra_Compacta_Decoteca(Obra) {
  const Datos_Teca = Obra.Datos_Teca ?? Obra.datos_teca;
  return {
    Id: Obra.Id ?? Obra.id,
    Teca_Id: Obra.Teca_Id ?? Obra.teca_id,
    Titulo: Obra.Titulo ?? Obra.titulo ?? "",
    Creador: Obra.Creador ?? Obra.creador ?? "",
    Anio: Obra.Anio ?? Obra.anio ?? "",
    Estado: Obra.Estado ?? Obra.estado ?? "",
    Genero: Obra.Genero ?? Obra.genero ?? "",
    Subgenero: Obra.Subgenero ?? Obra.subgenero ?? "",
    Descripcion: Obra.Descripcion ?? Obra.descripcion ?? "",
    Orden: Obra.Orden ?? Obra.orden ?? null,
    Progreso: Obra.Progreso ?? Obra.progreso ?? 0,
    Prioridad: Obra.Prioridad ?? Obra.prioridad ?? "",
    Periodo: Obra.Periodo ?? Obra.periodo ?? "",
    Portada_Url: Obra.Portada_Url ?? Obra.portada_url ?? "",
    Datos_Teca: Datos_Teca && typeof Datos_Teca === "object"
      ? {
        Unidad: Datos_Teca.Unidad ?? Datos_Teca.unidad ?? "",
        Total_Unidades:
          Datos_Teca.Total_Unidades ??
          Datos_Teca.total_unidades ??
          0,
      }
      : null,
    Partes_Total: Array.isArray(Obra.Partes ?? Obra.partes)
      ? (Obra.Partes ?? Obra.partes).length
      : 0,
  };
}
