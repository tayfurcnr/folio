#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unimplemented,
    clippy::todo,
    clippy::unreachable
)]
#![forbid(unsafe_code)]

use deckcraft_engine::{Mods, PointerEvent, PointerKind, Session};
use deckcraft_render::{RenderOpts, render_slide};
use serde::Serialize;
use serde_json::{Value, json};

const MAX_BATCH_SHAPES: usize = 1_000;
const MAX_BATCH_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineError {
    pub code: &'static str,
    pub message: String,
    pub retryable: bool,
}

impl EngineError {
    fn new(code: &'static str, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            retryable,
        }
    }
    fn invalid(message: impl Into<String>) -> Self {
        Self::new("INVALID_INPUT", message, false)
    }
    fn engine(message: impl Into<String>) -> Self {
        Self::new("ENGINE_ERROR", message, false)
    }
}

type EngineResult<T> = Result<T, EngineError>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

pub struct Engine {
    session: Session,
}

impl Engine {
    pub fn create_session() -> Self {
        Self {
            session: Session::with_new(),
        }
    }

    fn document(&self) -> EngineResult<&deckcraft_engine::DocState> {
        self.session
            .doc()
            .map_err(|error| EngineError::engine(error.to_string()))
    }

    fn result(&self, result: Value) -> EngineResult<Value> {
        let doc = self.document()?;
        Ok(
            json!({"result": result, "revision": doc.revision, "dirty": doc.is_dirty(),
            "canUndo": !doc.history.undo.is_empty(), "canRedo": !doc.history.redo.is_empty()}),
        )
    }

    pub fn execute(&mut self, command: &str, params_json: &str) -> EngineResult<Value> {
        let params: Value = serde_json::from_str(params_json).map_err(|error| {
            EngineError::invalid(format!("invalid command parameters: {error}"))
        })?;
        let value = self
            .session
            .execute(command, &params)
            .map_err(|error| EngineError::engine(error.to_string()))?;
        self.result(value)
    }

    pub fn insert_shapes_batch(&mut self, shapes_json: &str) -> EngineResult<Value> {
        if shapes_json.len() > MAX_BATCH_BYTES {
            return Err(EngineError::invalid(format!(
                "batch payload exceeds {MAX_BATCH_BYTES} bytes"
            )));
        }
        let shapes: Vec<deckcraft_model::Shape> =
            serde_json::from_str(shapes_json).map_err(|error| {
                EngineError::invalid(format!("invalid batch shape payload: {error}"))
            })?;
        if shapes.is_empty() || shapes.len() > MAX_BATCH_SHAPES {
            return Err(EngineError::invalid(format!(
                "batch must contain 1..={MAX_BATCH_SHAPES} shapes"
            )));
        }
        if self.document()?.selection.text.is_some() {
            return Err(EngineError::invalid(
                "finish text editing before inserting a shape batch",
            ));
        }

        // DeckCraft's paste command creates one undo step, but its recovery journal omits clipboard data.
        let clipboard = std::mem::take(&mut self.session.clipboard);
        let duplicate_offset = self.session.prefs.duplicate_offset;
        self.session.clipboard.shapes = shapes;
        self.session.prefs.duplicate_offset = 0.0;
        let result = self.session.execute("edit.paste", &Value::Null);
        self.session.clipboard = clipboard;
        self.session.prefs.duplicate_offset = duplicate_offset;
        let value = result.map_err(|error| EngineError::engine(error.to_string()))?;
        self.result(value)
    }

    pub fn pointer(&mut self, kind: &str, x: f64, y: f64, mods_json: &str) -> EngineResult<Value> {
        let kind = match kind {
            "down" => PointerKind::Down,
            "drag" => PointerKind::Drag,
            "up" => PointerKind::Up,
            "move" => PointerKind::Move,
            "doubleClick" => PointerKind::DoubleClick,
            "tripleClick" => PointerKind::TripleClick,
            "contextClick" => PointerKind::ContextClick,
            other => {
                return Err(EngineError::invalid(format!(
                    "unknown pointer kind: {other}"
                )));
            }
        };
        if !x.is_finite() || !y.is_finite() {
            return Err(EngineError::invalid("pointer coordinates must be finite"));
        }
        let mods: Mods = serde_json::from_str(mods_json)
            .map_err(|error| EngineError::invalid(format!("invalid modifier data: {error}")))?;
        let value = self
            .session
            .pointer(PointerEvent {
                kind,
                x,
                y,
                mods,
                tol: 4.0,
                pressure: None,
            })
            .map_err(|error| EngineError::engine(error.to_string()))?;
        self.result(value)
    }

    pub fn key(&mut self, key: &str, mods_json: &str) -> EngineResult<Value> {
        let mods: Mods = serde_json::from_str(mods_json)
            .map_err(|error| EngineError::invalid(format!("invalid modifier data: {error}")))?;
        let value = self
            .session
            .key(key, mods)
            .map_err(|error| EngineError::engine(error.to_string()))?;
        self.result(value)
    }

    pub fn compose_text(&mut self, text: &str, active_json: &str) -> EngineResult<Value> {
        let active: Option<(usize, usize)> = if active_json.is_empty() {
            None
        } else {
            Some(serde_json::from_str(active_json).map_err(|error| {
                EngineError::invalid(format!("invalid composition range: {error}"))
            })?)
        };
        let result = self
            .session
            .compose_text(text, active)
            .map_err(|error| EngineError::engine(error.to_string()))?;
        self.result(result)
    }

    pub fn commit_text(&mut self, text: &str) -> EngineResult<Value> {
        let result = self
            .session
            .commit_text(text)
            .map_err(|error| EngineError::engine(error.to_string()))?;
        self.result(result)
    }

    pub fn summary(&self) -> EngineResult<Value> {
        let doc = self.document()?;
        Ok(
            json!({"revision": doc.revision, "title": doc.title(), "activeSlideIndex": doc.selection.slide,
            "dirty": doc.is_dirty(), "canUndo": !doc.history.undo.is_empty(), "canRedo": !doc.history.redo.is_empty(),
            "slides": doc.doc.slides.iter().map(|slide| json!({"id": slide.id.0.to_string(), "title": slide.name})).collect::<Vec<_>>() }),
        )
    }

    pub fn slide_projection(&self, slide_id: &str) -> EngineResult<Value> {
        let doc = self.document()?;
        let id = slide_id
            .parse::<u32>()
            .map_err(|_| EngineError::invalid("slide id must be an unsigned integer string"))?;
        let slide = doc
            .doc
            .slides
            .iter()
            .find(|slide| slide.id.0 == id)
            .ok_or_else(|| {
                EngineError::new(
                    "NOT_FOUND",
                    format!("slide {slide_id} was not found"),
                    false,
                )
            })?;
        Ok(json!({"id": slide.id.0.to_string(), "title": slide.name,
            "shapes": slide.shapes.iter().map(|shape| json!({"id": shape.id.0.to_string(), "name": shape.name,
                "rect": shape.xfrm.map(|rect| [rect.x, rect.y, rect.w, rect.h]),
                "text": shape.text.as_ref().map(|text| text.text()),
                "fontFamilies": shape.text.as_ref().map(|text| text.paragraphs.iter().flat_map(|p| p.runs.iter())
                    .filter_map(|run| run.props.font.clone()).collect::<Vec<_>>())})).collect::<Vec<_>>() }))
    }

    pub fn selection_projection(&self) -> EngineResult<Value> {
        let doc = self.document()?;
        let slide_id = doc
            .doc
            .slides
            .get(doc.selection.slide)
            .map(|slide| slide.id.0.to_string());
        Ok(
            json!({"slideId": slide_id, "shapeIds": doc.selection.shapes.iter().map(|id| id.0.to_string()).collect::<Vec<_>>(),
            "textSelection": doc.selection.text, "isComposing": doc.composition.is_some()}),
        )
    }

    pub fn render_slide(&self, slide_id: &str, scale: f64) -> EngineResult<Frame> {
        let doc = self.document()?;
        let id = slide_id
            .parse::<u32>()
            .map_err(|_| EngineError::invalid("slide id must be an unsigned integer string"))?;
        let index = doc
            .doc
            .slides
            .iter()
            .position(|slide| slide.id.0 == id)
            .ok_or_else(|| {
                EngineError::new(
                    "NOT_FOUND",
                    format!("slide {slide_id} was not found"),
                    false,
                )
            })?;
        let scale = if scale.is_finite() {
            scale.clamp(0.1, 4.0)
        } else {
            1.0
        };
        let image = render_slide(
            &doc.doc,
            index,
            &RenderOpts {
                scale,
                edit: true,
                ..Default::default()
            },
        );
        Ok(Frame {
            width: image.width,
            height: image.height,
            pixels: image.pixels,
        })
    }

    pub fn export_pptx(&self) -> EngineResult<Vec<u8>> {
        deckcraft_pptx::export(&self.document()?.doc)
            .map_err(|error| EngineError::engine(error.to_string()))
    }

    pub fn import_pptx(&mut self, bytes: &[u8]) -> EngineResult<Value> {
        let presentation = deckcraft_pptx::import(bytes)
            .map_err(|error| EngineError::new("IMPORT_ERROR", error.to_string(), false))?;
        let slide_count = presentation.slides.len();
        self.session.add_document(deckcraft_engine::DocState::new(
            presentation,
            None,
            "Imported.pptx".into(),
        ));
        self.summary().map(|mut summary| {
            summary["importedSlideCount"] = json!(slide_count);
            summary
        })
    }

    pub fn undo(&mut self) -> EngineResult<Value> {
        self.execute("edit.undo", "{}")
    }
    pub fn redo(&mut self) -> EngineResult<Value> {
        self.execute("edit.redo", "{}")
    }
}

#[cfg(target_arch = "wasm32")]
mod wasm_api {
    use super::{Engine, EngineError};
    use js_sys::Uint8Array;
    use wasm_bindgen::prelude::*;

    fn js_error(error: EngineError) -> JsValue {
        serde_wasm_bindgen::to_value(&error).unwrap_or_else(|_| JsValue::from_str("{\"code\":\"SERIALIZATION_ERROR\",\"message\":\"Could not serialize engine error\",\"retryable\":false}"))
    }
    fn js_value(value: serde_json::Value) -> Result<JsValue, EngineError> {
        serde_wasm_bindgen::to_value(&value)
            .map_err(|error| EngineError::new("SERIALIZATION_ERROR", error.to_string(), false))
    }

    #[wasm_bindgen]
    pub struct FolioSession {
        engine: Engine,
    }

    #[wasm_bindgen(js_name = createSession)]
    pub fn create_session() -> FolioSession {
        FolioSession {
            engine: Engine::create_session(),
        }
    }

    #[wasm_bindgen]
    impl FolioSession {
        pub fn execute(&mut self, command: &str, params_json: &str) -> Result<JsValue, JsValue> {
            self.engine
                .execute(command, params_json)
                .and_then(js_value)
                .map_err(js_error)
        }
        #[wasm_bindgen(js_name = insertShapesBatch)]
        pub fn insert_shapes_batch(&mut self, shapes_json: &str) -> Result<JsValue, JsValue> {
            self.engine
                .insert_shapes_batch(shapes_json)
                .and_then(js_value)
                .map_err(js_error)
        }
        pub fn pointer(
            &mut self,
            kind: &str,
            x: f64,
            y: f64,
            mods_json: &str,
        ) -> Result<JsValue, JsValue> {
            self.engine
                .pointer(kind, x, y, mods_json)
                .and_then(js_value)
                .map_err(js_error)
        }
        pub fn key(&mut self, key: &str, mods_json: &str) -> Result<JsValue, JsValue> {
            self.engine
                .key(key, mods_json)
                .and_then(js_value)
                .map_err(js_error)
        }
        #[wasm_bindgen(js_name = composeText)]
        pub fn compose_text(&mut self, text: &str, active_json: &str) -> Result<JsValue, JsValue> {
            self.engine
                .compose_text(text, active_json)
                .and_then(js_value)
                .map_err(js_error)
        }
        #[wasm_bindgen(js_name = commitText)]
        pub fn commit_text(&mut self, text: &str) -> Result<JsValue, JsValue> {
            self.engine
                .commit_text(text)
                .and_then(js_value)
                .map_err(js_error)
        }
        #[wasm_bindgen(js_name = getDocumentSummary)]
        pub fn get_document_summary(&self) -> Result<JsValue, JsValue> {
            self.engine.summary().and_then(js_value).map_err(js_error)
        }
        #[wasm_bindgen(js_name = getSlideProjection)]
        pub fn get_slide_projection(&self, slide_id: &str) -> Result<JsValue, JsValue> {
            self.engine
                .slide_projection(slide_id)
                .and_then(js_value)
                .map_err(js_error)
        }
        #[wasm_bindgen(js_name = getSelectionProjection)]
        pub fn get_selection_projection(&self) -> Result<JsValue, JsValue> {
            self.engine
                .selection_projection()
                .and_then(js_value)
                .map_err(js_error)
        }
        #[wasm_bindgen(js_name = renderSlide)]
        pub fn render_slide(&self, slide_id: &str, scale: f64) -> Result<JsValue, JsValue> {
            let frame = self
                .engine
                .render_slide(slide_id, scale)
                .map_err(js_error)?;
            let pixels = Uint8Array::from(frame.pixels.as_slice());
            let object = js_sys::Object::new();
            js_sys::Reflect::set(&object, &"width".into(), &frame.width.into())?;
            js_sys::Reflect::set(&object, &"height".into(), &frame.height.into())?;
            js_sys::Reflect::set(&object, &"pixels".into(), &pixels)?;
            Ok(object.into())
        }
        pub fn undo(&mut self) -> Result<JsValue, JsValue> {
            self.engine.undo().and_then(js_value).map_err(js_error)
        }
        pub fn redo(&mut self) -> Result<JsValue, JsValue> {
            self.engine.redo().and_then(js_value).map_err(js_error)
        }
        #[wasm_bindgen(js_name = importPptx)]
        pub fn import_pptx(&mut self, bytes: &[u8]) -> Result<JsValue, JsValue> {
            self.engine
                .import_pptx(bytes)
                .and_then(js_value)
                .map_err(js_error)
        }
        #[wasm_bindgen(js_name = exportPptx)]
        pub fn export_pptx(&self) -> Result<Uint8Array, JsValue> {
            self.engine
                .export_pptx()
                .map(|bytes| Uint8Array::from(bytes.as_slice()))
                .map_err(js_error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Engine;
    use serde_json::json;

    #[test]
    fn session_isolation_summary_batch_undo_redo_and_projection() {
        let mut first = Engine::create_session();
        let second = Engine::create_session();
        let created = first.execute("slide.new", r#"{"layout":"blank"}"#);
        assert!(created.is_ok());
        let shape = first.execute("shape.insert", r#"{"preset":"rect","rect":[10,10,20,20]}"#);
        assert!(shape.is_ok());
        let summary = first.summary();
        assert!(summary.is_ok());
        assert_eq!(
            summary
                .ok()
                .and_then(|v| v["slides"].as_array().map(Vec::len)),
            Some(2)
        );
        assert_eq!(
            second
                .summary()
                .ok()
                .and_then(|v| v["slides"].as_array().map(Vec::len)),
            Some(1)
        );
        let slide_id = first
            .summary()
            .ok()
            .and_then(|v| v["slides"][1]["id"].as_str().map(str::to_owned));
        let Some(slide_id) = slide_id else {
            panic!("slide id missing")
        };
        let projected = first.slide_projection(&slide_id);
        assert!(projected.is_ok_and(|value| {
            value["shapes"]
                .as_array()
                .is_some_and(|items| items.len() == 1)
        }));
        let shapes = json!([{"name":"Batch","xfrm":{"x":50.0,"y":50.0,"w":20.0,"h":20.0},"geom":{"kind":"preset","name":"rect"}}]);
        assert!(first.insert_shapes_batch(&shapes.to_string()).is_ok());
        let count_after = first
            .slide_projection(&slide_id)
            .ok()
            .and_then(|v| v["shapes"].as_array().map(Vec::len));
        assert_eq!(count_after, Some(2));
        assert!(first.undo().is_ok());
        assert_eq!(
            first
                .slide_projection(&slide_id)
                .ok()
                .and_then(|v| v["shapes"].as_array().map(Vec::len)),
            Some(1)
        );
        assert!(first.redo().is_ok());
        assert_eq!(
            first
                .slide_projection(&slide_id)
                .ok()
                .and_then(|v| v["shapes"].as_array().map(Vec::len)),
            Some(2)
        );
    }

    #[test]
    fn pointer_key_render_and_structured_errors() {
        let mut engine = Engine::create_session();
        assert!(engine.execute("slide.new", r#"{"layout":"blank"}"#).is_ok());
        assert!(engine.pointer("down", 10.0, 10.0, "{}").is_ok());
        assert!(engine.key("Escape", "{}").is_ok());
        assert_eq!(
            engine
                .pointer("down", f64::NAN, 0.0, "{}")
                .err()
                .map(|e| e.code),
            Some("INVALID_INPUT")
        );
        assert_eq!(
            engine.execute("not.a.command", "{}").err().map(|e| e.code),
            Some("ENGINE_ERROR")
        );
        let slide_id = engine
            .summary()
            .ok()
            .and_then(|v| v["slides"][1]["id"].as_str().map(str::to_owned));
        assert!(slide_id.is_some_and(|id| engine.render_slide(&id, 1.0).is_ok()));
    }

    #[test]
    fn pptx_round_trip_and_batch_rejection() {
        let mut engine = Engine::create_session();
        assert!(engine.execute("slide.new", r#"{"layout":"blank"}"#).is_ok());
        assert!(
            engine
                .execute("shape.insert", r#"{"preset":"rect","rect":[10,10,20,20]}"#)
                .is_ok()
        );
        let bytes = engine.export_pptx();
        assert!(bytes.as_ref().is_ok_and(|bytes| !bytes.is_empty()));
        let mut imported = Engine::create_session();
        let result = bytes.and_then(|bytes| imported.import_pptx(&bytes));
        assert!(result.is_ok());
        assert_eq!(
            imported
                .summary()
                .ok()
                .and_then(|v| v["slides"].as_array().map(Vec::len)),
            Some(2)
        );
        assert!(engine.insert_shapes_batch("[]").is_err());
        assert!(
            engine
                .insert_shapes_batch(&" ".repeat(super::MAX_BATCH_BYTES + 1))
                .is_err()
        );
    }
}
