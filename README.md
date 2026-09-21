# Propuestas de mejora Ayora I

Aplicación web progresiva para cumplimentar en campo el formulario RG-SPM-28, recoger firma táctil, generar el PDF y preparar su envío por WhatsApp.

## Funciones incluidas

- Formulario guiado para personal Eiffage, empresas y autónomos.
- Firma manuscrita táctil y registro de negativa o imposibilidad de firma.
- Fotografías como anexo del documento.
- Generación local del PDF con la estructura del modelo RG-SPM-28.
- Histórico local mediante IndexedDB.
- Borrador local y funcionamiento sin conexión tras la primera carga.
- Compartir el PDF mediante la hoja nativa del móvil.
- Accesos directos a los chats de Marina y Alberto con mensaje preparado.

## Privacidad y alcance

Esta primera versión funciona completamente en el dispositivo. No envía datos a un servidor y GitHub solo aloja el código y la plantilla. Los números de teléfono se configuran desde la propia aplicación y quedan guardados localmente.

La firma dibujada es evidencia de recepción, pero no es una firma electrónica cualificada. Para un despliegue corporativo deben validarse la conservación, los plazos de supresión, el control de accesos y la información de protección de datos.

## Publicación en GitHub Pages

1. Crear un repositorio, preferiblemente privado, y subir estos archivos a la rama `main`.
2. En `Settings > Pages`, seleccionar `Deploy from a branch` y la carpeta raíz de `main`.
3. Abrir la URL publicada desde el móvil y elegir `Añadir a pantalla de inicio`.

> Aviso: según el plan de GitHub, una página publicada desde un repositorio privado puede seguir teniendo acceso público. No se almacenan expedientes en GitHub, pero conviene usar un alojamiento corporativo con autenticación para el uso definitivo.

## Prueba local

Servir la carpeta con un servidor HTTP, por ejemplo `python -m http.server 8080`, y abrir `http://localhost:8080`. La generación del PDF no funciona abriendo `index.html` directamente como archivo.
