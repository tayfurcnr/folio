#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unimplemented,
    clippy::todo,
    clippy::unreachable
)]
#![forbid(unsafe_code)]
#![recursion_limit = "256"]

use deckcraft_engine::{Mods, PointerEvent, PointerKind, Session, ToolKind};
use deckcraft_render::{RenderOpts, SlidePart, render_slide, render_slide_part};
use deckcraft_model::ShapeId;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const MAX_BATCH_SHAPES: usize = 1_000;
const MAX_BATCH_BYTES: usize = 16 * 1024 * 1024;
const MAX_RICH_PASTE_CHARS: usize = 100_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RichPastePayload {
    text: String,
    paragraphs: Vec<RichPasteParagraph>,
}

#[derive(Deserialize)]
struct RichPasteParagraph {
    runs: Vec<RichPasteRun>,
}

#[derive(Deserialize)]
struct RichPasteRun {
    text: String,
    props: deckcraft_model::text::RunProps,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FolioClipboardMedia {
    id: deckcraft_model::MediaId,
    name: String,
    content_type: String,
    bytes: Vec<u8>,
    link: Option<String>,
}

#[derive(Deserialize)]
struct FolioClipboardPayload {
    shapes: Vec<deckcraft_model::Shape>,
    media: Vec<FolioClipboardMedia>,
}

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

fn finite_param(params: &Value, key: &str, default: f64, min: f64, max: f64) -> f64 {
    params.get(key).and_then(Value::as_f64).filter(|value| value.is_finite()).unwrap_or(default).clamp(min, max)
}

fn parse_hex_color(value: &str) -> Option<deckcraft_color::Rgba> {
    let raw = value.strip_prefix('#')?;
    if raw.len() != 6 { return None; }
    let red = u8::from_str_radix(&raw[0..2], 16).ok()?;
    let green = u8::from_str_radix(&raw[2..4], 16).ok()?;
    let blue = u8::from_str_radix(&raw[4..6], 16).ok()?;
    Some(deckcraft_color::Rgba::rgb(red, green, blue))
}

fn apply_text_effect_body(
    body: &mut deckcraft_model::text::TextBody,
    range: Option<((usize, usize), (usize, usize))>,
    is_glow: bool,
    shadow_color: &deckcraft_model::ColorRef,
    blur: f64,
    distance: f64,
    angle: f64,
    glow_color: &deckcraft_model::ColorRef,
    glow_radius: f64,
    glow_on: bool,
) {
    let update = |run: &mut deckcraft_model::text::Run| {
        if is_glow && run.props.shadow.is_some() {
            run.props.shadow = None;
            run.props.glow = glow_on.then(|| deckcraft_model::style::Glow { color: glow_color.clone(), radius: glow_radius });
        } else if let Some(shadow) = run.props.shadow.as_mut() {
            shadow.color = shadow_color.clone(); shadow.blur = blur; shadow.dist = distance; shadow.dir = angle;
        }
    };
    if let Some(((start_paragraph, start_char), (end_paragraph, end_char))) = range {
        let Some(last) = body.paragraphs.len().checked_sub(1) else { return };
        for (pi, paragraph) in body.paragraphs.iter_mut().enumerate().take(end_paragraph.min(last) + 1).skip(start_paragraph.min(last)) {
            let from = if pi == start_paragraph { start_char } else { 0 };
            let to = if pi == end_paragraph { end_char } else { paragraph.char_len() };
            let mut offset = 0;
            for run in &mut paragraph.runs {
                let run_end = offset + run.char_len();
                if run_end > from && offset < to { update(run); }
                offset = run_end;
            }
        }
    } else {
        for run in body.paragraphs.iter_mut().flat_map(|paragraph| paragraph.runs.iter_mut()) { update(run); }
    }
}

/// Resolve slide placeholder geometry with the same model inheritance rules used by DeckCraft's
/// renderer and pointer hit-testing. A missing layout/master context means no effective box.
fn projected_xfrm(
    ctx: Option<&deckcraft_model::resolve::Ctx<'_>>,
    shape: &deckcraft_model::Shape,
) -> Option<deckcraft_engine::geom::Xfrm> {
    shape.xfrm.or_else(|| ctx.map(|ctx| deckcraft_model::resolve::xfrm(ctx, shape)))
}

fn resize_font_scale(before: deckcraft_engine::geom::Xfrm, after: deckcraft_engine::geom::Xfrm) -> f64 {
    let sx = (after.w / before.w.max(0.001)).abs();
    let sy = (after.h / before.h.max(0.001)).abs();
    (sx * sy).sqrt().clamp(0.1, 10.0)
}

fn scaled_text_body(
    presentation: &deckcraft_model::Presentation,
    slide_index: usize,
    shape_id: ShapeId,
    factor: f64,
) -> Option<deckcraft_model::text::TextBody> {
    let slide = presentation.slides.get(slide_index)?;
    let shape = slide.shape(shape_id)?;
    let mut body = shape.text.as_ref()?.clone();
    let context = deckcraft_model::resolve::Ctx::for_slide(presentation, slide)?;
    let scale_size = |size: Option<f64>| (size.unwrap_or(18.0) * factor).clamp(1.0, 4000.0);
    for index in 0..body.paragraphs.len() {
        let Some(paragraph) = body.paragraphs.get(index) else { continue };
        let default_size = deckcraft_model::resolve::run(&context, shape, paragraph, &paragraph.def_props).size;
        let end_size = deckcraft_model::resolve::run(&context, shape, paragraph, &paragraph.end_props).size;
        let run_sizes = paragraph.runs.iter().map(|run| {
            deckcraft_model::resolve::run(&context, shape, paragraph, &run.props).size
        }).collect::<Vec<_>>();
        let Some(paragraph) = body.paragraphs.get_mut(index) else { continue };
        paragraph.def_props.size = Some(scale_size(default_size));
        paragraph.end_props.size = Some(scale_size(end_size));
        for (run, size) in paragraph.runs.iter_mut().zip(run_sizes) {
            run.props.size = Some(scale_size(size));
        }
    }
    Some(body)
}

/// Build a throwaway render projection with localized built-in empty-placeholder prompts.
/// Stored presentation text and the Rust Session are never modified by this display-only pass.
fn localized_render_document(
    presentation: &deckcraft_model::Presentation,
    slide_index: usize,
    locale: EditorLocale,
) -> deckcraft_model::Presentation {
    let mut rendered = presentation.clone();
    let Some(slide) = rendered.slides.get(slide_index) else { return rendered };
    let requests = {
        let Some(context) = deckcraft_model::resolve::Ctx::for_slide(&rendered, slide) else { return rendered };
        slide.shapes.iter().filter_map(|shape| {
            if shape.ph.is_none() || shape.text.as_ref().is_some_and(|text| !text.is_empty()) { return None; }
            let kind = shape.ph_type()?;
            let prompt = locale.prompt(kind)?;
            let (layout_shape, _) = deckcraft_model::resolve::parents(&context, shape);
            let layout_shape = layout_shape?;
            if layout_shape.ph.as_ref().is_some_and(|placeholder| placeholder.has_custom_prompt) { return None; }
            Some((slide.layout, layout_shape.id, kind, prompt))
        }).collect::<Vec<_>>()
    };
    for master in &mut rendered.masters {
        let master = std::sync::Arc::make_mut(master);
        for (layout_id, shape_id, kind, prompt) in &requests {
            let Some(layout) = master.layouts.iter_mut().find(|layout| layout.id == *layout_id) else { continue };
            let Some(shape) = layout.shapes.iter_mut().find(|shape| shape.id == *shape_id) else { continue };
            if let Some(placeholder) = shape.ph.as_mut() { placeholder.has_custom_prompt = true; }
            let mut body = deckcraft_model::text::TextBody::from_text(prompt);
            if matches!(kind, deckcraft_model::PhType::Picture | deckcraft_model::PhType::Chart | deckcraft_model::PhType::Table | deckcraft_model::PhType::Media | deckcraft_model::PhType::Diagram | deckcraft_model::PhType::ClipArt) {
                body.body.anchor = Some(deckcraft_model::text::Anchor::Bottom);
                if let Some(paragraph) = body.paragraphs.first_mut() {
                    paragraph.props.align = Some(deckcraft_model::text::Align::Center);
                    paragraph.props.bullet = Some(deckcraft_model::text::Bullet::None);
                    paragraph.props.margin_left = Some(0.0);
                    paragraph.props.indent = Some(0.0);
                    for run in &mut paragraph.runs { run.props.size = Some(14.0); }
                }
            }
            shape.text = Some(body);
        }
    }
    rendered
}

const ELEMENT_OPACITY_TAG: &str = "folio.elementOpacity";

fn element_opacity(shape: &deckcraft_model::Shape) -> f64 {
    shape.tags.iter().find(|(name, _)| name == ELEMENT_OPACITY_TAG)
        .and_then(|(_, value)| value.parse::<f64>().ok())
        .filter(|value| value.is_finite())
        .unwrap_or(1.0).clamp(0.0, 1.0)
}

fn opacity_color(color: &mut deckcraft_model::ColorRef, opacity: f64) {
    if opacity < 0.999_999 {
        color.mods.push(deckcraft_model::ColorTransform::AlphaMod((opacity * 100_000.0).round() as i32));
    }
}

fn remove_opacity_color(color: &mut deckcraft_model::ColorRef, opacity: f64) {
    let expected = (opacity * 100_000.0).round() as i32;
    if let Some(index) = color.mods.iter().rposition(|transform|
        matches!(transform, deckcraft_model::ColorTransform::AlphaMod(value) if *value == expected))
    {
        color.mods.remove(index);
    }
}

fn opacity_fill(fill: &mut deckcraft_model::Fill, opacity: f64) {
    use deckcraft_model::Fill;
    match fill {
        Fill::Solid { color } => opacity_color(color, opacity),
        Fill::Gradient(gradient) => {
            for stop in &mut gradient.stops { opacity_color(&mut stop.color, opacity); }
        }
        Fill::Picture(picture) => picture.alpha = Some(picture.alpha.unwrap_or(1.0) * opacity),
        Fill::Pattern(pattern) => { opacity_color(&mut pattern.fg, opacity); opacity_color(&mut pattern.bg, opacity); }
        Fill::None | Fill::Group | Fill::Background => {}
    }
}

fn remove_opacity_fill(fill: &mut deckcraft_model::Fill, opacity: f64) {
    use deckcraft_model::Fill;
    match fill {
        Fill::Solid { color } => remove_opacity_color(color, opacity),
        Fill::Gradient(gradient) => for stop in &mut gradient.stops { remove_opacity_color(&mut stop.color, opacity); },
        Fill::Picture(picture) => picture.alpha = picture.alpha.map(|alpha| (alpha / opacity).clamp(0.0, 1.0)),
        Fill::Pattern(pattern) => { remove_opacity_color(&mut pattern.fg, opacity); remove_opacity_color(&mut pattern.bg, opacity); }
        Fill::None | Fill::Group | Fill::Background => {}
    }
}

fn opacity_line(line: &mut deckcraft_model::Line, opacity: f64) {
    if let Some(fill) = line.fill.as_mut() { opacity_fill(fill, opacity); }
}

fn opacity_run_props(props: &mut deckcraft_model::text::RunProps, opacity: f64) {
    if let Some(fill) = props.fill.as_mut() { opacity_fill(fill, opacity); }
    if let Some(color) = props.underline_color.as_mut() { opacity_color(color, opacity); }
    if let Some(color) = props.highlight.as_mut() { opacity_color(color, opacity); }
    if let Some(line) = props.outline.as_mut() { opacity_line(line, opacity); }
    if let Some(shadow) = props.shadow.as_mut() { opacity_color(&mut shadow.color, opacity); }
    if let Some(shadow) = props.inner_shadow.as_mut() { opacity_color(&mut shadow.color, opacity); }
    if let Some(glow) = props.glow.as_mut() { opacity_color(&mut glow.color, opacity); }
    if let Some(reflection) = props.reflection.as_mut() {
        reflection.start_alpha *= opacity;
        reflection.end_alpha *= opacity;
    }
}

fn remove_opacity_run_props(props: &mut deckcraft_model::text::RunProps, opacity: f64) {
    if let Some(fill) = props.fill.as_mut() { remove_opacity_fill(fill, opacity); }
    if let Some(color) = props.underline_color.as_mut() { remove_opacity_color(color, opacity); }
    if let Some(color) = props.highlight.as_mut() { remove_opacity_color(color, opacity); }
    if let Some(line) = props.outline.as_mut() { if let Some(fill) = line.fill.as_mut() { remove_opacity_fill(fill, opacity); } }
    if let Some(shadow) = props.shadow.as_mut() { remove_opacity_color(&mut shadow.color, opacity); }
    if let Some(shadow) = props.inner_shadow.as_mut() { remove_opacity_color(&mut shadow.color, opacity); }
    if let Some(glow) = props.glow.as_mut() { remove_opacity_color(&mut glow.color, opacity); }
    if let Some(reflection) = props.reflection.as_mut() {
        reflection.start_alpha = (reflection.start_alpha / opacity).clamp(0.0, 1.0);
        reflection.end_alpha = (reflection.end_alpha / opacity).clamp(0.0, 1.0);
    }
}

fn bake_element_opacity(presentation: &mut deckcraft_model::Presentation) {
    fn visit(shapes: &mut [deckcraft_model::Shape], inherited: f64, depth: usize) {
        if depth > 32 { return; }
        for shape in shapes {
            let own = element_opacity(shape);
            let opacity = inherited * own;
            if opacity < 0.999_999 {
                if let Some(fill) = shape.fill.as_mut() { opacity_fill(fill, opacity); }
                if let Some(line) = shape.line.as_mut() { opacity_line(line, opacity); }
                if let Some(fill) = shape.style.as_mut().map(|style| &mut style.fill_ref.1) { opacity_color(fill, opacity); }
                if let Some(line) = shape.style.as_mut().map(|style| &mut style.line_ref.1) { opacity_color(line, opacity); }
                if let Some(text) = shape.text.as_mut() {
                    for level in text.list_style.levels.iter_mut().flatten() { opacity_run_props(&mut level.run, opacity); }
                    for paragraph in &mut text.paragraphs {
                        if let Some(color) = paragraph.props.bullet_color.as_mut() { opacity_color(color, opacity); }
                        opacity_run_props(&mut paragraph.def_props, opacity);
                        opacity_run_props(&mut paragraph.end_props, opacity);
                        for run in &mut paragraph.runs { opacity_run_props(&mut run.props, opacity); }
                    }
                }
                if let Some(effects) = shape.effects.as_mut() {
                    if let Some(shadow) = effects.outer_shadow.as_mut() { opacity_color(&mut shadow.color, opacity); }
                    if let Some(shadow) = effects.inner_shadow.as_mut() { opacity_color(&mut shadow.color, opacity); }
                    if let Some(glow) = effects.glow.as_mut() { opacity_color(&mut glow.color, opacity); }
                    if let Some(reflection) = effects.reflection.as_mut() {
                        reflection.start_alpha *= opacity;
                        reflection.end_alpha *= opacity;
                    }
                    if let Some(overlay) = effects.fill_overlay.as_mut() { opacity_fill(&mut overlay.fill, opacity); }
                }
                match &mut shape.kind {
                    deckcraft_model::ShapeKind::Picture { fill } => fill.alpha = Some(fill.alpha.unwrap_or(1.0) * opacity),
                    deckcraft_model::ShapeKind::Ink { strokes } => for stroke in strokes {
                        stroke.color.a = (f64::from(stroke.color.a) * opacity).round().clamp(0.0, 255.0) as u8;
                    },
                    _ => {}
                }
            }
            if let Some(children) = shape.children_mut() { visit(children, opacity, depth + 1); }
        }
    }
    for slide in &mut presentation.slides { visit(&mut std::sync::Arc::make_mut(slide).shapes, 1.0, 0); }
}

fn unbake_element_opacity(presentation: &mut deckcraft_model::Presentation) {
    fn visit(shapes: &mut [deckcraft_model::Shape], inherited: f64, depth: usize) {
        if depth > 32 { return; }
        for shape in shapes {
            let own = element_opacity(shape);
            let opacity = inherited * own;
            if opacity > 0.0 && opacity < 0.999_999 {
                if let Some(fill) = shape.fill.as_mut() { remove_opacity_fill(fill, opacity); }
                if let Some(line) = shape.line.as_mut() { if let Some(fill) = line.fill.as_mut() { remove_opacity_fill(fill, opacity); } }
                if let Some(style) = shape.style.as_mut() {
                    remove_opacity_color(&mut style.fill_ref.1, opacity);
                    remove_opacity_color(&mut style.line_ref.1, opacity);
                    remove_opacity_color(&mut style.effect_ref.1, opacity);
                }
                if let Some(text) = shape.text.as_mut() {
                    for level in text.list_style.levels.iter_mut().flatten() {
                        remove_opacity_color_if_any(&mut level.para.bullet_color, opacity);
                        remove_opacity_run_props(&mut level.run, opacity);
                    }
                    for paragraph in &mut text.paragraphs {
                        remove_opacity_color_if_any(&mut paragraph.props.bullet_color, opacity);
                        remove_opacity_run_props(&mut paragraph.def_props, opacity);
                        remove_opacity_run_props(&mut paragraph.end_props, opacity);
                        for run in &mut paragraph.runs { remove_opacity_run_props(&mut run.props, opacity); }
                    }
                }
                if let Some(effects) = shape.effects.as_mut() {
                    if let Some(shadow) = effects.outer_shadow.as_mut() { remove_opacity_color(&mut shadow.color, opacity); }
                    if let Some(shadow) = effects.inner_shadow.as_mut() { remove_opacity_color(&mut shadow.color, opacity); }
                    if let Some(glow) = effects.glow.as_mut() { remove_opacity_color(&mut glow.color, opacity); }
                    if let Some(reflection) = effects.reflection.as_mut() {
                        reflection.start_alpha = (reflection.start_alpha / opacity).clamp(0.0, 1.0);
                        reflection.end_alpha = (reflection.end_alpha / opacity).clamp(0.0, 1.0);
                    }
                    if let Some(overlay) = effects.fill_overlay.as_mut() { remove_opacity_fill(&mut overlay.fill, opacity); }
                }
                match &mut shape.kind {
                    deckcraft_model::ShapeKind::Picture { fill } => fill.alpha = fill.alpha.map(|alpha| (alpha / opacity).clamp(0.0, 1.0)),
                    deckcraft_model::ShapeKind::Ink { strokes } => for stroke in strokes {
                        stroke.color.a = (f64::from(stroke.color.a) / opacity).round().clamp(0.0, 255.0) as u8;
                    },
                    _ => {}
                }
            }
            if let Some(children) = shape.children_mut() { visit(children, opacity, depth + 1); }
        }
    }
    for slide in &mut presentation.slides { visit(&mut std::sync::Arc::make_mut(slide).shapes, 1.0, 0); }
}

fn remove_opacity_color_if_any(color: &mut Option<deckcraft_model::ColorRef>, opacity: f64) {
    if let Some(color) = color.as_mut() { remove_opacity_color(color, opacity); }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MovePreviewFrames {
    pub active_background: Frame,
    pub overflow_background: Frame,
    pub selected_shapes: Frame,
    pub selected_active_shapes: Frame,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedPreviewFrames {
    pub selected_shapes: Frame,
    pub selected_active_shapes: Frame,
}

pub struct Engine {
    session: Session,
    locale: EditorLocale,
    pending_text_resize: Option<(ShapeId, deckcraft_engine::geom::Xfrm, u8)>,
}

#[derive(Clone, Copy)]
enum EditorLocale {
    Turkish,
    English,
}

impl EditorLocale {
    fn from_tag(locale: &str) -> Self {
        if locale.split(['-', '_']).next().is_some_and(|language| language.eq_ignore_ascii_case("en")) {
            Self::English
        } else {
            Self::Turkish
        }
    }

    fn prompt(self, kind: deckcraft_model::PhType) -> Option<&'static str> {
        use deckcraft_model::PhType;
        Some(match (self, kind) {
            (Self::Turkish, PhType::Title | PhType::CtrTitle) => "Başlık eklemek için tıklayın",
            (Self::Turkish, PhType::SubTitle) => "Alt başlık eklemek için tıklayın",
            (Self::Turkish, PhType::Body | PhType::Obj) => "Metin eklemek için tıklayın",
            (Self::Turkish, PhType::Chart) => "Grafik eklemek için simgeye tıklayın",
            (Self::Turkish, PhType::Table) => "Tablo eklemek için simgeye tıklayın",
            (Self::Turkish, PhType::Diagram) => "SmartArt grafiği eklemek için simgeye tıklayın",
            (Self::Turkish, PhType::Media) => "Medya eklemek için simgeye tıklayın",
            (Self::Turkish, PhType::Picture | PhType::ClipArt) => "Resim eklemek için simgeye tıklayın",
            (Self::Turkish, PhType::Date) => "Tarih",
            (Self::Turkish, PhType::Footer) => "Alt bilgi",
            (Self::Turkish, PhType::SlideNum) => "‹#›",
            (Self::Turkish, PhType::Header) => "Üst bilgi",
            (Self::Turkish, PhType::SlideImage) => return None,
            (Self::English, PhType::Title | PhType::CtrTitle) => "Click to add title",
            (Self::English, PhType::SubTitle) => "Click to add subtitle",
            (Self::English, PhType::Body | PhType::Obj) => "Click to add text",
            (Self::English, PhType::Chart) => "Click icon to add chart",
            (Self::English, PhType::Table) => "Click icon to add table",
            (Self::English, PhType::Diagram) => "Click icon to add SmartArt graphic",
            (Self::English, PhType::Media) => "Click icon to add media",
            (Self::English, PhType::Picture | PhType::ClipArt) => "Click icon to add picture",
            (Self::English, PhType::Date) => "Date",
            (Self::English, PhType::Footer) => "Footer",
            (Self::English, PhType::SlideNum) => "‹#›",
            (Self::English, PhType::Header) => "Header",
            (Self::English, PhType::SlideImage) => return None,
        })
    }
}

impl Engine {
    pub fn create_session() -> Self {
        Self {
            session: Session::with_new(),
            locale: EditorLocale::Turkish,
            pending_text_resize: None,
        }
    }

    pub fn set_locale(&mut self, locale: &str) {
        self.locale = EditorLocale::from_tag(locale);
    }

    pub fn font_families(&self) -> Vec<String> {
        deckcraft_fonts::FontDb::global().families()
    }

    pub fn get_media_bytes(&self, shape_id: &str) -> EngineResult<Vec<u8>> {
        let raw_id = shape_id.parse::<u32>().map_err(|_| EngineError::invalid("media shape id must be an integer"))?;
        let state = self.session.doc().map_err(|error| EngineError::engine(error.to_string()))?;
        let shape = state.shape(ShapeId(raw_id)).ok_or_else(|| EngineError::new("NOT_FOUND", format!("shape {raw_id} was not found"), false))?;
        let deckcraft_model::ShapeKind::Media(clip) = &shape.kind else {
            return Err(EngineError::invalid("selected shape is not audio or video"));
        };
        state.doc.media(clip.media).map(|item| item.data.to_vec())
            .ok_or_else(|| EngineError::new("NOT_FOUND", "media bytes were not found", false))
    }

    pub fn set_ink_tool(&mut self, mode: &str) -> EngineResult<()> {
        if !matches!(mode, "pen" | "highlighter" | "eraser") {
            return Err(EngineError::invalid("ink mode must be pen, highlighter, or eraser"));
        }
        self.session.set_tool(ToolKind::Ink {
            mode: mode.to_owned(),
            color: deckcraft_model::Rgba::rgb(31, 41, 55),
            width: if mode == "highlighter" { 18.0 } else { 3.0 },
        });
        Ok(())
    }

    pub fn set_select_tool(&mut self) {
        self.session.set_tool(ToolKind::Select);
    }

    pub fn create_blank_slide(&mut self) -> EngineResult<Value> {
        self.execute("slide.new", r#"{"layout":"blank"}"#)
    }

    fn document(&self) -> EngineResult<&deckcraft_engine::DocState> {
        self.session
            .doc()
            .map_err(|error| EngineError::engine(error.to_string()))
    }

    fn result(&mut self, result: Value) -> EngineResult<Value> {
        let doc = self.document()?;
        let mut update = json!({"result": result, "revision": doc.revision, "dirty": doc.is_dirty(),
            "canUndo": !doc.history.undo.is_empty(), "canRedo": !doc.history.redo.is_empty()});
        let (requests, others): (Vec<_>, Vec<_>) = std::mem::take(&mut self.session.ui_requests).into_iter().partition(|request| {
            matches!(request, deckcraft_engine::UiRequest::Media { .. }) || matches!(request, deckcraft_engine::UiRequest::Dialog { id, .. } if id == "paragraph" || id == "tabs" || id == "font" || id == "columns")
        });
        if !requests.is_empty() {
            update["mediaRequests"] = json!(requests.iter().filter(|request| matches!(request, deckcraft_engine::UiRequest::Media { .. })).collect::<Vec<_>>());
            update["uiRequests"] = json!(requests);
        }
        self.session.ui_requests = others;
        Ok(update)
    }

    pub fn execute(&mut self, command: &str, params_json: &str) -> EngineResult<Value> {
        let params: Value = serde_json::from_str(params_json).map_err(|error| {
            EngineError::invalid(format!("invalid command parameters: {error}"))
        })?;
        if command == "folio.formatPainterCancel" {
            self.session.painter = None;
            return self.result(json!({"cancelled": true}));
        }
        if command == "presentation.applyTemplate" {
            return self.apply_template(&params);
        }
        if command == "folio.iconCatalog" {
            return self.result(json!(deckcraft_engine::icons::icons().iter().map(|icon| json!({
                "name": icon.name,
                "label": icon.label,
                "category": icon.category,
                "path": icon.d,
                "stroke": icon.stroke,
            })).collect::<Vec<_>>()));
        }
        if command == "folio.elementOpacity" {
            return self.set_element_opacity(&params, false);
        }
        if command == "folio.elementOpacityEnd" {
            return self.set_element_opacity(&params, true);
        }
        if command == "folio.textPasteRich" {
            return self.paste_rich_text(&params);
        }
        let is_glow = command == "folio.textGlow";
        let engine_command = if is_glow { "format.textShadow" } else { command };
        let engine_params = if is_glow { json!({"on": true}) } else { params.clone() };
        let shadow_selection = if (command == "format.textShadow" && params.get("on").and_then(Value::as_bool).unwrap_or(true)) || is_glow {
            self.session.doc().ok().map(|state| {
                let text = state.selection.text.clone();
                let range = text.as_ref().map(|selection| deckcraft_engine::cmd::text::format_range(state, selection));
                (text, range, state.selection.shapes.clone())
            })
        } else { None };
        let mut value = self
            .session
            .execute(engine_command, &engine_params)
            .map_err(|error| EngineError::engine(error.to_string()))?;
        if let Some((text_selection, text_range, shape_ids)) = shadow_selection {
            let shadow_color = params.get("color").and_then(Value::as_str).and_then(parse_hex_color)
                .map(deckcraft_model::ColorRef::rgb)
                .unwrap_or_else(|| deckcraft_model::ColorRef::rgb(deckcraft_color::Rgba::rgb(0, 0, 0))
                    .with(deckcraft_color::ColorTransform::Alpha(43000)));
            let blur = finite_param(&params, "blur", 3.0, 0.0, 100.0);
            let dist = finite_param(&params, "distance", 2.0, 0.0, 100.0);
            let dir = finite_param(&params, "angle", 45.0, -360.0, 360.0);
            let glow_color = params.get("color").and_then(Value::as_str).and_then(parse_hex_color)
                .map(deckcraft_model::ColorRef::rgb).unwrap_or_else(|| deckcraft_model::ColorRef::rgb(deckcraft_color::Rgba::rgb(255, 200, 0)));
            let glow_radius = finite_param(&params, "radius", 8.0, 0.0, 100.0);
            let glow_on = params.get("on").and_then(Value::as_bool).unwrap_or(true);
            let state = self.session.doc_mut().map_err(|error| EngineError::engine(error.to_string()))?;
            let slide_index = state.selection.slide;
            let mut document = (*state.doc).clone();
            if let Some(slide) = document.slides.get_mut(slide_index) {
                let slide = std::sync::Arc::make_mut(slide);
                let target = text_selection.as_ref().map(|selection| selection.shape);
                for shape in slide.shapes.iter_mut().filter(|shape| target == Some(shape.id) || (target.is_none() && shape_ids.contains(&shape.id))) {
                    if let Some(selection) = text_selection.as_ref() {
                        let Some((start, end)) = text_range else { continue };
                        if let Some((row, column)) = selection.cell {
                            let deckcraft_model::ShapeKind::Table(table) = &mut shape.kind else { continue };
                            if let Some(cell) = table.rows.get_mut(row).and_then(|row| row.cells.get_mut(column)) {
                                apply_text_effect_body(&mut cell.text, Some((start, end)), is_glow, &shadow_color, blur, dist, dir, &glow_color, glow_radius, glow_on);
                            }
                        } else if let Some(body) = shape.text.as_mut() {
                            apply_text_effect_body(body, Some((start, end)), is_glow, &shadow_color, blur, dist, dir, &glow_color, glow_radius, glow_on);
                        }
                    } else if let Some(body) = shape.text.as_mut() {
                        apply_text_effect_body(body, None, is_glow, &shadow_color, blur, dist, dir, &glow_color, glow_radius, glow_on);
                    }
                }
            }
            state.doc = std::sync::Arc::new(document);
        }
        if matches!(command, "edit.copy" | "edit.cut") && !self.session.clipboard.shapes.is_empty() {
            let clipboard = json!({
                "shapes": self.session.clipboard.shapes,
                "media": self.session.clipboard.media.iter().map(|item| json!({
                    "id": item.id,
                    "name": item.name,
                    "contentType": item.content_type,
                    "bytes": item.data.as_slice(),
                    "link": item.link,
                })).collect::<Vec<_>>(),
            });
            if clipboard.to_string().len() <= MAX_BATCH_BYTES {
                value["folioClipboard"] = clipboard;
            }
        }
        if command == "insert.textBox" {
            let rect = params.get("rect").and_then(Value::as_array).filter(|values| values.len() == 4)
                .and_then(|values| Some([values[0].as_f64()?, values[1].as_f64()?, values[2].as_f64()?, values[3].as_f64()?]));
            let id = value.get("id").and_then(Value::as_u64).map(|id| ShapeId(id as u32));
            if let (Some([x, y, w, h]), Some(id)) = (rect.filter(|rect| rect[2] >= 1.0), id) {
                // DeckCraft's insert command auto-fits an empty text shape to one line.
                // Restore Folio's user-drawn frame in the same command/undo step.
                let state = self.session.doc_mut().map_err(|error| EngineError::engine(error.to_string()))?;
                let slide_index = state.selection.slide;
                if slide_index < state.doc.slides.len() {
                    let mut document = (*state.doc).clone();
                    let slide = std::sync::Arc::make_mut(&mut document.slides[slide_index]);
                    if let Some(shape) = slide.shapes.iter_mut().find(|shape| shape.id == id) {
                        shape.xfrm = Some(deckcraft_engine::geom::Xfrm::new(x, y, w, h));
                        if let Some(text) = shape.text.as_mut() {
                            text.body.autofit = Some(deckcraft_model::text::AutoFit::None);
                        }
                    }
                    state.doc = std::sync::Arc::new(document);
                }
            }
        }
        self.result(value)
    }

    fn paste_rich_text(&mut self, params: &Value) -> EngineResult<Value> {
        if params.to_string().len() > MAX_BATCH_BYTES {
            return Err(EngineError::invalid("rich text clipboard payload is too large"));
        }
        let payload: RichPastePayload = serde_json::from_value(params.clone())
            .map_err(|error| EngineError::invalid(format!("invalid rich text clipboard payload: {error}")))?;
        if payload.text.chars().count() > MAX_RICH_PASTE_CHARS || payload.paragraphs.is_empty() || payload.paragraphs.len() > 10_000 {
            return Err(EngineError::invalid("rich text clipboard payload exceeds the supported limit"));
        }
        let flattened = payload.paragraphs.iter().map(|paragraph| paragraph.runs.iter().map(|run| run.text.as_str()).collect::<String>()).collect::<Vec<_>>().join("\n");
        if flattened != payload.text || payload.paragraphs.iter().any(|paragraph| paragraph.runs.len() > 10_000) {
            return Err(EngineError::invalid("rich text clipboard payload does not match its text"));
        }
        let selection = self.session.doc().map_err(|error| EngineError::engine(error.to_string()))?
            .selection.text.clone().ok_or_else(|| EngineError::invalid("rich text paste requires an active text cursor"))?;
        let (start, _) = selection.ordered();

        // DeckCraft records this insertion as a single undoable edit and correctly replaces
        // the current selection. The following style pass mutates the same inserted text.
        let value = self.session.execute("text.insert", &json!({"text": payload.text}))
            .map_err(|error| EngineError::engine(error.to_string()))?;
        self.session.edit(|presentation, selection_state| {
            let active = selection_state.text.as_ref().ok_or_else(|| deckcraft_engine::EngineError::Other("text selection was lost during rich paste".into()))?;
            let body = if active.notes {
                let slide = presentation.slides.get_mut(selection_state.slide).ok_or_else(|| deckcraft_engine::EngineError::Other("active slide was not found".into()))?;
                &mut std::sync::Arc::make_mut(slide).notes
            } else {
                let shapes = deckcraft_engine::shapes_mut(presentation, selection_state).ok_or_else(|| deckcraft_engine::EngineError::Other("text shape collection was not found".into()))?;
                let shape = deckcraft_model::find_shape_mut(shapes, active.shape).ok_or_else(|| deckcraft_engine::EngineError::Other("text shape was not found".into()))?;
                if let Some((row, col)) = active.cell {
                    let deckcraft_model::ShapeKind::Table(table) = &mut shape.kind else { return Err(deckcraft_engine::EngineError::Other("text selection is not inside a table".into())); };
                    &mut table.cell_mut(row, col).ok_or_else(|| deckcraft_engine::EngineError::Other("table cell was not found".into()))?.text
                } else {
                    shape.text.get_or_insert_with(deckcraft_model::text::TextBody::default)
                }
            };

            for (paragraph_offset, source_paragraph) in payload.paragraphs.iter().enumerate() {
                let para_index = start.0 + paragraph_offset;
                let paragraph = body.paragraphs.get_mut(para_index).ok_or_else(|| deckcraft_engine::EngineError::Other("inserted paragraph was not found".into()))?;
                let range_start = if paragraph_offset == 0 { start.1 } else { 0 };
                let range_end = range_start + source_paragraph.runs.iter().map(|run| run.text.chars().count()).sum::<usize>();
                let mut cursor = 0usize;
                let mut styled_runs = Vec::new();
                for existing in paragraph.runs.drain(..) {
                    let chars = existing.text.chars().collect::<Vec<_>>();
                    let run_start = cursor;
                    let run_end = cursor + chars.len();
                    let overlap_start = run_start.max(range_start);
                    let overlap_end = run_end.min(range_end);
                    if overlap_start >= overlap_end {
                        styled_runs.push(existing);
                    } else {
                        let local_start = overlap_start - run_start;
                        let local_end = overlap_end - run_start;
                        if local_start > 0 {
                            let mut prefix = existing.clone();
                            prefix.text = chars[..local_start].iter().collect();
                            styled_runs.push(prefix);
                        }
                        let mut source_cursor = 0usize;
                        for source_run in &source_paragraph.runs {
                            let source_end = source_cursor + source_run.text.chars().count();
                            let piece_start = overlap_start.max(range_start + source_cursor);
                            let piece_end = overlap_end.min(range_start + source_end);
                            if piece_start < piece_end {
                                let mut props = existing.props.clone();
                                if source_run.props.font.is_some() { props.font.clone_from(&source_run.props.font); }
                                if source_run.props.size.is_some() { props.size = source_run.props.size; }
                                if source_run.props.bold.is_some() { props.bold = source_run.props.bold; }
                                if source_run.props.italic.is_some() { props.italic = source_run.props.italic; }
                                if source_run.props.underline.is_some() { props.underline.clone_from(&source_run.props.underline); }
                                if source_run.props.fill.is_some() { props.fill.clone_from(&source_run.props.fill); }
                                let text = source_run.text.chars()
                                    .skip(piece_start - (range_start + source_cursor))
                                    .take(piece_end - piece_start)
                                    .collect::<String>();
                                styled_runs.push(deckcraft_model::text::Run::with(text, props));
                            }
                            source_cursor = source_end;
                        }
                        if local_end < chars.len() {
                            let mut suffix = existing;
                            suffix.text = chars[local_end..].iter().collect();
                            styled_runs.push(suffix);
                        }
                    }
                    cursor = run_end;
                }
                paragraph.runs = styled_runs;
            }
            Ok(())
        }).map_err(|error| EngineError::engine(error.to_string()))?;
        self.result(json!({"text": payload.text, "inserted": true, "caret": value.get("caret").cloned().unwrap_or(Value::Null)}))
    }

    fn set_element_opacity(&mut self, params: &Value, end: bool) -> EngineResult<Value> {
        let opacity = params.get("opacity").and_then(Value::as_f64)
            .filter(|value| value.is_finite())
            .map(|value| value.clamp(0.0, 1.0))
            .ok_or_else(|| EngineError::invalid("element opacity must be a number from 0 to 1"))?;
        let ids = params.get("ids").and_then(Value::as_array)
            .ok_or_else(|| EngineError::invalid("element opacity requires shape ids"))?
            .iter().map(|id| id.as_u64().filter(|id| *id <= u64::from(u32::MAX)).map(|id| ShapeId(id as u32)))
            .collect::<Option<Vec<_>>>().ok_or_else(|| EngineError::invalid("element opacity contains an invalid shape id"))?;
        if ids.is_empty() || ids.len() > MAX_BATCH_SHAPES { return Err(EngineError::invalid("element opacity requires 1 to 1000 shapes")); }
        if end {
            if self.session.doc().ok().and_then(|state| state.interaction.as_ref()).is_some_and(|interaction| interaction.label == "Rotation") {
                let value = self.session.execute("shape.rotate", &json!({"gesture":"end"}))
                    .map_err(|error| EngineError::engine(error.to_string()))?;
                return self.result(value);
            }
            return self.result(json!({"opacity": opacity}));
        }
        let opacity_interaction_open = self.session.active().and_then(|active| active.interaction.as_ref())
            .is_some_and(|interaction| interaction.label == "Rotation");
        if self.session.active().and_then(|active| active.interaction.as_ref()).is_some() && !opacity_interaction_open {
            return Err(EngineError::engine("another document edit is still active"));
        }
        if !opacity_interaction_open {
            self.session.execute("shape.rotate", &json!({"gesture":"move", "by":0}))
                .map_err(|error| EngineError::engine(error.to_string()))?;
        }
        let state = self.session.doc_mut().map_err(|error| EngineError::engine(error.to_string()))?;
        let slide_index = state.selection.slide;
        let before = state.interaction.as_ref().map(|interaction| interaction.doc.clone()).unwrap_or_else(|| state.doc.clone());
        let mut document = (*before).clone();
        let slide = document.slides.get_mut(slide_index).ok_or_else(|| EngineError::engine("active slide was not found"))?;
        let shapes = &mut std::sync::Arc::make_mut(slide).shapes;
        for id in &ids {
            let shape = deckcraft_model::find_shape_mut(shapes, *id).ok_or_else(|| EngineError::new("NOT_FOUND", format!("shape {id} was not found"), false))?;
            shape.tags.retain(|(name, _)| name != ELEMENT_OPACITY_TAG);
            if opacity < 0.999_999 { shape.tags.push((ELEMENT_OPACITY_TAG.into(), format!("{opacity:.6}"))); }
        }
        state.doc = std::sync::Arc::new(document);
        state.revision += 1;
        Ok(json!({"opacity": opacity, "shapeIds": ids.iter().map(|id| id.0.to_string()).collect::<Vec<_>>()}))
    }

    fn apply_template(&mut self, params: &Value) -> EngineResult<Value> {
        let slides = params.get("slides").and_then(Value::as_array)
            .filter(|slides| !slides.is_empty() && slides.len() <= 24)
            .ok_or_else(|| EngineError::invalid("template must contain 1..=24 slides"))?;
        let backgrounds = params.get("backgrounds").and_then(Value::as_array)
            .filter(|colors| colors.len() == 2)
            .ok_or_else(|| EngineError::invalid("template must contain two background colors"))?;
        let parse_color = |value: &Value| -> EngineResult<[u8; 3]> {
            let text = value.as_str().ok_or_else(|| EngineError::invalid("template color must be a hex string"))?;
            let hex = text.strip_prefix('#').unwrap_or(text);
            if hex.len() != 6 { return Err(EngineError::invalid("template color must use #RRGGBB")); }
            let channel = |range: std::ops::Range<usize>| u8::from_str_radix(&hex[range], 16)
                .map_err(|_| EngineError::invalid("template color must use #RRGGBB"));
            Ok([channel(0..2)?, channel(2..4)?, channel(4..6)?])
        };
        let colors = [parse_color(&backgrounds[0])?, parse_color(&backgrounds[1])?];
        let accent = parse_color(params.get("accent").unwrap_or(&backgrounds[0]))?;
        let mut outline = String::new();
        let mut layout_keys = Vec::with_capacity(slides.len());
        for item in slides {
            let title = item.get("title").and_then(Value::as_str).filter(|s| !s.trim().is_empty())
                .ok_or_else(|| EngineError::invalid("every template slide needs a title"))?;
            let bullets = item.get("bullets").and_then(Value::as_array).ok_or_else(|| EngineError::invalid("every template slide needs a bullet list"))?;
            outline.push_str(title.trim());
            outline.push('\n');
            for bullet in bullets {
                let bullet = bullet.as_str().ok_or_else(|| EngineError::invalid("template bullets must be text"))?;
                if !bullet.trim().is_empty() { outline.push_str("\t"); outline.push_str(bullet.trim()); outline.push('\n'); }
            }
            layout_keys.push(item.get("layout").and_then(Value::as_str).unwrap_or("title-content").to_owned());
        }

        let before = self.document()?.doc.slides.len();
        let insert_at = (self.document()?.selection.slide + 1).min(before);
        let value = self.session.execute("slide.fromOutline", &json!({"text": outline, "markdown": false}))
            .map_err(|error| EngineError::engine(error.to_string()))?;
        let created_ids: Vec<_> = self.document()?.doc.slides.iter().skip(insert_at).take(slides.len()).map(|slide| slide.id).collect();
        if created_ids.len() != slides.len() {
            let _ = self.session.execute("edit.undo", &Value::Null);
            return Err(EngineError::engine("template outline did not create the expected slides"));
        }

        let state = self.session.doc_mut().map_err(|error| EngineError::engine(error.to_string()))?;
        let mut document = (*state.doc).clone();
        let master_index = document.slides.get(insert_at.saturating_sub(1))
            .and_then(|slide| document.masters.iter().position(|master| master.layout(slide.layout).is_some())).unwrap_or(0);
        for (index, (item, slide_id)) in slides.iter().zip(created_ids.iter()).enumerate() {
            let key = match layout_keys[index].as_str() {
                "title" => "title", "two-column" => "twoContent", "comparison" => "comparison",
                "section" => "sectionHeader", "title-only" => "titleOnly", "image-focus" => "pictureWithCaption",
                "title-chart" | "title-content" => "titleAndContent", _ => "titleAndContent",
            };
            let layout = deckcraft_engine::cmd::slide::find_layout(&document, &Value::String(key.to_owned()), master_index)
                .or_else(|| deckcraft_engine::cmd::slide::find_layout(&document, &Value::String("titleAndContent".into()), master_index))
                .ok_or_else(|| EngineError::engine("presentation master has no content layout"))?;
            let mut slide = deckcraft_model::defaults::new_slide(&mut document, layout)
                .ok_or_else(|| EngineError::engine("presentation has no remaining object IDs"))?;
            slide.id = *slide_id;
            let title = item.get("title").and_then(Value::as_str).unwrap_or_default();
            let bullets: Vec<&str> = item.get("bullets").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).collect();
            let body = bullets.join("\n");
            let rgb = colors[usize::from(index > 0)];
            slide.background = Some(deckcraft_model::Background::Fill { fill: deckcraft_model::Fill::solid(
                deckcraft_model::ColorRef::rgb(deckcraft_color::Rgba::rgb(rgb[0], rgb[1], rgb[2]))
            ) });
            let left: Vec<&str> = if key == "twoContent" { bullets.iter().take((bullets.len() + 1) / 2).copied().collect() } else { bullets.clone() };
            let right: Vec<&str> = if key == "twoContent" { bullets.iter().skip((bullets.len() + 1) / 2).copied().collect() } else { Vec::new() };
            let mut body_index = 0;
            for shape in &mut slide.shapes {
                if shape.ph_type().is_some_and(|kind| kind.is_title()) {
                    shape.text = Some(deckcraft_model::text::TextBody::from_text(title));
                } else if shape.ph_type().is_some_and(|kind| matches!(kind, deckcraft_model::PhType::Body | deckcraft_model::PhType::Obj | deckcraft_model::PhType::SubTitle)) {
                    let content = if key == "twoContent" && body_index == 1 { right.join("\n") } else if key == "twoContent" { left.join("\n") } else { body.clone() };
                    if !content.is_empty() { shape.text = Some(deckcraft_model::text::TextBody::from_text(&content)); }
                    body_index += 1;
                }
            }
            // Give template slides an editable visual identity, not just a tinted background.
            // These native DeckCraft shapes stay inside the same slide.fromOutline undo step.
            let accent_color = deckcraft_model::ColorRef::rgb(deckcraft_color::Rgba::rgb(accent[0], accent[1], accent[2]));
            let mut add_accent = |name: &str, geom: &str, x: f64, y: f64, w: f64, h: f64| -> EngineResult<()> {
                let id = document.alloc_id().map(ShapeId).ok_or_else(|| EngineError::engine("presentation has no remaining object IDs"))?;
                slide.shapes.push(deckcraft_model::Shape {
                    id,
                    name: name.to_owned(),
                    xfrm: Some(deckcraft_engine::geom::Xfrm::new(x, y, w, h)),
                    geom: deckcraft_model::Geom::preset(geom),
                    fill: Some(deckcraft_model::Fill::solid(accent_color.clone())),
                    line: Some(deckcraft_model::Line::none()),
                    decorative: true,
                    ..Default::default()
                });
                Ok(())
            };
            if index == 0 {
                add_accent("Şablon vurgu şeridi", "rect", 0.0, 0.0, 960.0, 16.0)?;
                add_accent("Şablon vurgu şekli", "ellipse", 770.0, 112.0, 150.0, 150.0)?;
            } else {
                add_accent("Şablon vurgu çizgisi", "rect", 48.0, 52.0, 84.0, 6.0)?;
                if index % 2 == 0 {
                    add_accent("Şablon vurgu şekli", "ellipse", 852.0, 430.0, 42.0, 42.0)?;
                }
            }
            document.slides[insert_at + index] = std::sync::Arc::new(slide);
        }
        state.selection.slide = insert_at;
        state.selection.slides = created_ids;
        state.selection.shapes.clear();
        state.selection.text = None;
        state.selection.cells = None;
        state.doc = std::sync::Arc::new(document);
        state.revision += 1;
        self.result(value)
    }

    pub fn type_text(&mut self, text: &str) -> EngineResult<Value> {
        let value = self
            .session
            .type_text(text)
            .map_err(|error| EngineError::engine(error.to_string()))?;
        self.result(value)
    }

    pub fn insert_shapes_batch(&mut self, payload_json: &str) -> EngineResult<Value> {
        if payload_json.len() > MAX_BATCH_BYTES {
            return Err(EngineError::invalid(format!(
                "batch payload exceeds {MAX_BATCH_BYTES} bytes"
            )));
        }
        let FolioClipboardPayload { shapes, media } = serde_json::from_str(payload_json).map_err(|error| {
            EngineError::invalid(format!("invalid clipboard batch payload: {error}"))
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
        self.session.clipboard.media = media.into_iter().map(|item| deckcraft_model::MediaItem {
            id: item.id,
            name: item.name,
            content_type: item.content_type,
            data: std::sync::Arc::new(item.bytes),
            link: item.link,
        }).collect();
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

        // Canva text boxes resize from the left and right pill handles without scaling their font.
        // DeckCraft exposes eight resize handles, so reject the hidden corners and vertical edges
        // for text boxes and placeholders while leaving text-bearing shapes fully resizable.
        let hidden_text_handle = if kind == PointerKind::Down {
            match self.session.hit_test(deckcraft_engine::geom::Point::new(x, y), 4.0) {
                Some(deckcraft_engine::tools::Hit::Resize { id, handle }) if handle != 3 && handle != 7 => self
                    .session
                    .doc()
                    .map_err(|error| EngineError::engine(error.to_string()))?
                    .shape(id)
                    .is_some_and(|shape| shape.text_box || shape.ph.is_some()),
                _ => false,
            }
        } else {
            false
        };
        if hidden_text_handle {
            return Ok(Value::Null);
        }

        if kind == PointerKind::Down {
            self.pending_text_resize = match self.session.hit_test(deckcraft_engine::geom::Point::new(x, y), 4.0) {
                Some(deckcraft_engine::tools::Hit::Resize { id, handle }) => self
                    .session
                    .doc()
                    .map_err(|error| EngineError::engine(error.to_string()))?
                    .shape(id)
                    .filter(|shape| shape.text.is_some())
                    .and_then(|shape| shape.xfrm.map(|rect| (id, rect, handle))),
                _ => None,
            };
        }

        // DeckCraft's default AutoFit::Shape refits text boxes after a resize. Capture the user's
        // final frame so Folio can preserve it after the engine settles the pointer gesture.
        let completed_text_resize = if kind == PointerKind::Up {
            self.pending_text_resize.take().and_then(|(id, original, handle)| {
                self.session
                    .doc()
                    .ok()?
                    .shape(id)
                    .and_then(|shape| shape.xfrm)
                    .filter(|rect| *rect != original)
                    .map(|rect| (id, original, rect, handle))
            })
        } else {
            None
        };
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

        if let Some((id, original, rect, handle)) = completed_text_resize {
            let state = self.session.doc_mut().map_err(|error| EngineError::engine(error.to_string()))?;
            let mut document = (*state.doc).clone();
            let slide_index = state.selection.slide;
            let font_scale = if handle % 2 == 0 {
                Some(resize_font_scale(original, rect))
            } else {
                None
            };
            let text = font_scale.and_then(|factor| scaled_text_body(&document, slide_index, id, factor));
            if let Some(shape) = document
                .slides
                .get_mut(slide_index)
                .and_then(|slide| {
                    std::sync::Arc::make_mut(slide)
                        .shapes
                        .iter_mut()
                        .find(|shape| shape.id == id && shape.text.is_some())
                })
            {
                shape.xfrm = Some(rect);
                if let Some(body) = text {
                    shape.text = Some(body);
                }
                if let Some(body) = shape.text.as_mut() {
                    body.body.autofit = Some(deckcraft_model::text::AutoFit::None);
                }
                state.doc = std::sync::Arc::new(document);
                state.revision += 1;
            }
        }
        let mut update = self.result(value)?;
        update["toolGuides"] = serde_json::to_value(&self.session.tool.guides)
            .map_err(|error| EngineError::engine(error.to_string()))?;
        Ok(update)
    }

    pub fn hit_test(&self, x: f64, y: f64, tolerance: f64) -> EngineResult<Value> {
        if !x.is_finite() || !y.is_finite() || !tolerance.is_finite() {
            return Err(EngineError::invalid("hit-test coordinates and tolerance must be finite"));
        }
        let hit = self.session.hit_test(deckcraft_engine::geom::Point::new(x, y), tolerance.max(0.0));
        let Some(hit) = hit else { return Ok(Value::Null) };
        let mut result = serde_json::to_value(hit).map_err(|error| EngineError::engine(error.to_string()))?;
        let id = result.get("id").and_then(Value::as_u64).map(|id| id as u32);
        if let (Some(id), Some(object)) = (id, result.as_object_mut()) {
            let state = self.document()?;
            let locked = state.doc.slides.get(state.selection.slide).and_then(|slide| slide.shape(ShapeId(id))).is_some_and(|shape| shape.locked);
            object.insert("locked".into(), json!(locked));
        }
        Ok(result)
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
            json!({"revision": doc.revision, "title": if doc.doc.props.title.trim().is_empty() { doc.title() } else { doc.doc.props.title.clone() }, "activeSlideIndex": doc.selection.slide,
            "dirty": doc.is_dirty(), "canUndo": !doc.history.undo.is_empty(), "canRedo": !doc.history.redo.is_empty(),
            "slides": doc.doc.slides.iter().map(|slide| json!({"id": slide.id.0.to_string(), "title": slide.name, "hidden": slide.hidden})).collect::<Vec<_>>(),
            "slideSize": [doc.doc.slide_size.width, doc.doc.slide_size.height],
            "sections": doc.doc.sections.iter().map(|section| json!({"name": section.name,
                "slideIds": section.slides.iter().map(|id| id.0.to_string()).collect::<Vec<_>>()})).collect::<Vec<_>>() }),
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
        let ctx = deckcraft_model::resolve::Ctx::for_slide(&doc.doc, slide);
        let (background_color, background_type) = ctx.as_ref().map(|ctx| {
            let (background_fill, background_ph) = deckcraft_model::resolve::background(ctx, Some(slide));
            let kind = match &background_fill {
                deckcraft_model::Fill::Solid { .. } => "solid",
                deckcraft_model::Fill::Gradient(_) => "gradient",
                deckcraft_model::Fill::Picture(_) => "image",
                deckcraft_model::Fill::Pattern(_) => "pattern",
                deckcraft_model::Fill::None | deckcraft_model::Fill::Group | deckcraft_model::Fill::Background => "none",
            };
            let color = if let deckcraft_model::Fill::Solid { color } = &background_fill {
                let rgba = ctx.color(color, background_ph);
                Some(format!("#{:02X}{:02X}{:02X}", rgba.r, rgba.g, rgba.b))
            } else {
                None
            };
            (color, kind)
        }).unwrap_or((None, "unknown"));
        Ok(json!({"id": slide.id.0.to_string(), "title": slide.name, "notes": slide.notes.text(), "backgroundColor": background_color, "backgroundType": background_type, "transition": slide.transition.as_ref().map(|transition| json!({"kind": transition.kind, "option": transition.option, "durationMs": transition.duration_ms, "advanceOnClick": transition.advance_on_click, "advanceAfterMs": transition.advance_after_ms})),
            "shapes": slide.shapes.iter().map(|shape| {
                let paragraph_tabs = shape.text.as_ref().map(|text| text.paragraphs.iter().map(|paragraph| paragraph.props.tabs.as_ref().map(|tabs| tabs.iter().map(|tab| {
                    let mut entry = serde_json::Map::new();
                    entry.insert("pos".into(), json!(tab.pos));
                    entry.insert("align".into(), json!(tab.align));
                    serde_json::Value::Object(entry)
                }).collect::<Vec<_>>()).unwrap_or_default()).collect::<Vec<_>>());
                let text_styles = shape.text.as_ref().map(|text| text.paragraphs.iter().flat_map(|paragraph| paragraph.runs.iter().map(|run| {
                    let props = ctx.as_ref().map(|ctx| deckcraft_model::resolve::run(ctx, shape, paragraph, &run.props));
                    let outline = props.as_ref().and_then(|props| props.outline.as_ref());
                    let shadow = props.as_ref().and_then(|props| props.shadow.as_ref());
                    let shadow_color = shadow.and_then(|shadow| ctx.as_ref().map(|ctx| ctx.color(&shadow.color, None)))
                        .map(|color| format!("#{:02X}{:02X}{:02X}", color.r, color.g, color.b));
                    let glow = props.as_ref().and_then(|props| props.glow.as_ref());
                    let glow_color = glow.and_then(|glow| ctx.as_ref().map(|ctx| ctx.color(&glow.color, None)))
                        .map(|color| format!("#{:02X}{:02X}{:02X}", color.r, color.g, color.b));
                    let outline_color = outline.and_then(|line| line.fill.as_ref()).and_then(|fill| match fill {
                        deckcraft_model::Fill::Solid { color } => ctx.as_ref().map(|ctx| ctx.color(color, None)),
                        _ => None,
                    }).map(|color| format!("#{:02X}{:02X}{:02X}", color.r, color.g, color.b));
                    json!({
                        "text": run.content(),
                        "bold": props.as_ref().and_then(|p| p.bold).unwrap_or(run.props.bold.unwrap_or(false)),
                        "italic": props.as_ref().and_then(|p| p.italic).unwrap_or(run.props.italic.unwrap_or(false)),
                        "underline": props.as_ref().and_then(|p| p.underline.as_deref()).is_some_and(|style| style != "none"),
                        "outlineColor": outline_color,
                        "outlineWidth": outline.and_then(|line| line.width),
                        "shadow": props.as_ref().is_some_and(|props| props.shadow.is_some()),
                        "shadowColor": shadow_color,
                        "shadowBlur": shadow.map(|shadow| shadow.blur),
                        "shadowDistance": shadow.map(|shadow| shadow.dist),
                        "shadowAngle": shadow.map(|shadow| shadow.dir),
                        "glow": glow.is_some(),
                        "glowColor": glow_color,
                        "glowRadius": glow.map(|glow| glow.radius),
                    })
                })).collect::<Vec<_>>());
                let text_paragraphs = shape.text.as_ref().map(|text| text.paragraphs.iter().map(|paragraph| json!({"runs": paragraph.runs.iter().map(|run| {
                    let props = ctx.as_ref().map(|ctx| deckcraft_model::resolve::run(ctx, shape, paragraph, &run.props));
                    let color = props.as_ref().and_then(|props| props.fill.as_ref()).and_then(|fill| match fill {
                        deckcraft_model::Fill::Solid { color } => ctx.as_ref().map(|ctx| ctx.color(color, None)),
                        _ => None,
                    }).map(|color| format!("#{:02X}{:02X}{:02X}", color.r, color.g, color.b));
                    json!({
                        "text": run.content(),
                        "bold": props.as_ref().and_then(|p| p.bold).unwrap_or(run.props.bold.unwrap_or(false)),
                        "italic": props.as_ref().and_then(|p| p.italic).unwrap_or(run.props.italic.unwrap_or(false)),
                        "underline": props.as_ref().and_then(|p| p.underline.as_deref()).is_some_and(|style| style != "none"),
                        "font": props.as_ref().and_then(|p| p.font.clone()).or_else(|| run.props.font.clone()),
                        "size": props.as_ref().and_then(|p| p.size).or(run.props.size),
                        "color": color,
                    })
                }).collect::<Vec<_>>()})).collect::<Vec<_>>());
                json!({"id": shape.id.0.to_string(), "name": shape.name, "hidden": shape.hidden, "locked": shape.locked, "group": matches!(&shape.kind, deckcraft_model::ShapeKind::Group { .. }), "textBox": shape.text_box, "preset": shape.geom.preset_name(), "placeholder": shape.ph.is_some(), "altText": shape.descr, "decorative": shape.decorative, "clickAction": shape.click.as_ref().and_then(|link| serde_json::to_value(link).ok()),
                "pictureCrop": match &shape.kind { deckcraft_model::ShapeKind::Picture { fill } => Some(fill.crop), _ => None },
                "pictureEffect": match &shape.kind { deckcraft_model::ShapeKind::Picture { fill } => fill.artistic.as_ref().map(|artistic| artistic.effect.as_str()), _ => None },
                "pictureAdjust": match &shape.kind { deckcraft_model::ShapeKind::Picture { fill } => Some(json!({"brightness": fill.adjust.brightness, "contrast": fill.adjust.contrast, "saturation": fill.adjust.saturation.unwrap_or(1.0), "grayscale": fill.adjust.grayscale, "transparency": 1.0 - fill.alpha.unwrap_or(1.0)})), _ => None },
                "media": match &shape.kind { deckcraft_model::ShapeKind::Media(media) => Some(json!({"contentType": doc.doc.media(media.media).map(|item| item.content_type.as_str()).unwrap_or("application/octet-stream"), "video": media.video, "durationMs": media.duration_ms, "width": media.width, "height": media.height, "autoplay": media.autoplay, "loop": media.loop_play, "rewind": media.rewind, "acrossSlides": media.play_across_slides, "hide": media.hide_while_not_playing, "fullScreen": media.full_screen, "volume": media.volume, "trimStart": media.trim_start_ms, "trimEnd": media.trim_end_ms, "fadeIn": media.fade_in_ms, "fadeOut": media.fade_out_ms})), _ => None },
                "chart": match &shape.kind { deckcraft_model::ShapeKind::Chart(chart) => Some(json!({"type": chart.kind, "title": chart.title, "categories": chart.categories, "series": chart.series.iter().map(|series| json!({"name": series.name, "values": series.values})).collect::<Vec<_>>()})), _ => None },
                "table": match &shape.kind { deckcraft_model::ShapeKind::Table(table) => Some(json!({"rows": table.rows.len(), "columns": table.cols.len(), "style": table.style, "headerRow": table.first_row, "totalRow": table.last_row, "bandedRows": table.band_row, "firstColumn": table.first_col, "lastColumn": table.last_col, "bandedColumns": table.band_col, "cells": table.rows.iter().map(|row| row.cells.iter().map(|cell| cell.text.text()).collect::<Vec<_>>()).collect::<Vec<_>>(), "merges": table.rows.iter().enumerate().flat_map(|(row_index, row)| row.cells.iter().enumerate().filter_map(move |(column_index, cell)| (cell.grid_span > 1 || cell.row_span > 1).then_some([row_index, column_index, cell.row_span as usize, cell.grid_span as usize]))).collect::<Vec<_>>()})), _ => None },
                "rect": projected_xfrm(ctx.as_ref(), shape).map(|rect| [rect.x, rect.y, rect.w, rect.h]),
                "rotation": projected_xfrm(ctx.as_ref(), shape).map(|rect| rect.rot),
                "lineWidth": ctx.as_ref().and_then(|ctx| deckcraft_model::resolve::line(ctx, shape).0.width),
                "lineDash": ctx.as_ref().map(|ctx| deckcraft_model::resolve::line(ctx, shape).0.dash.map(|dash| match dash { deckcraft_model::style::Dash::Preset { name } => name, deckcraft_model::style::Dash::Custom { .. } => "custom".to_string() }).unwrap_or_else(|| "solid".to_string())),
                "elementOpacity": element_opacity(shape),
                "flipH": projected_xfrm(ctx.as_ref(), shape).map(|rect| rect.flip_h), "flipV": projected_xfrm(ctx.as_ref(), shape).map(|rect| rect.flip_v),
                "textBoxOptions": shape.text.as_ref().map(|text| json!({"wrap": text.body.wrap, "autofit": text.body.autofit.map(|fit| match fit { deckcraft_model::text::AutoFit::None => "none", deckcraft_model::text::AutoFit::Shrink { .. } => "shrink", deckcraft_model::text::AutoFit::Shape => "resize" }), "margins": [text.body.inset_l, text.body.inset_t, text.body.inset_r, text.body.inset_b], "columns": text.body.columns, "columnSpacing": text.body.col_spacing, "direction": text.body.vert.map(|direction| direction.xml()), "anchor": text.body.anchor.map(|anchor| format!("{anchor:?}"))})),
                "textWarp": shape.text.as_ref().and_then(|text| text.body.warp.clone()),
                "paragraphRtl": shape.text.as_ref().map(|text| text.paragraphs.iter().map(|paragraph| paragraph.props.rtl.unwrap_or(false)).collect::<Vec<_>>()),
                "text": shape.text.as_ref().map(|text| text.text()),
                "fontFamilies": shape.text.as_ref().map(|text| text.paragraphs.iter().flat_map(|p| p.runs.iter())
                    .filter_map(|run| run.props.font.clone()).collect::<Vec<_>>()),
                "fontSizes": shape.text.as_ref().map(|text| text.paragraphs.iter().flat_map(|p| p.runs.iter())
                    .filter_map(|run| run.props.size).collect::<Vec<_>>()),
                "characterSpacings": shape.text.as_ref().map(|text| text.paragraphs.iter().flat_map(|paragraph| paragraph.runs.iter()
                    .map(|run| ctx.as_ref().map(|ctx| deckcraft_model::resolve::run(ctx, shape, paragraph, &run.props).spacing.unwrap_or(0.0)).unwrap_or(0.0))).collect::<Vec<_>>()),
                "paragraphLineSpacings": shape.text.as_ref().map(|text| text.paragraphs.iter().map(|paragraph| {
                    let spacing = ctx.as_ref().and_then(|ctx| deckcraft_model::resolve::para(ctx, shape, paragraph).line_spacing);
                    match spacing {
                        Some(deckcraft_model::text::Spacing::Pct(value)) => json!({"kind":"pct","value":value}),
                        Some(deckcraft_model::text::Spacing::Pts(value)) => json!({"kind":"pt","value":value}),
                        None => json!({"kind":"pct","value":1.0}),
                    }
                }).collect::<Vec<_>>()),
                "paragraphAlignments": shape.text.as_ref().map(|text| text.paragraphs.iter().map(|paragraph| paragraph.props.align.map(|alignment| format!("{alignment:?}")).unwrap_or_default()).collect::<Vec<_>>()),
                "paragraphBullets": shape.text.as_ref().map(|text| text.paragraphs.iter().map(|paragraph| format!("{:?}", paragraph.props.bullet)).collect::<Vec<_>>()),
                "paragraphTabs": paragraph_tabs, "textStyles": text_styles, "textParagraphs": text_paragraphs})}).collect::<Vec<_>>() }))
    }

    pub fn selected_shape_geometry(&self, slide_id: &str, selected_ids_json: &str) -> EngineResult<Value> {
        let doc = self.document()?;
        let slide_id = slide_id.parse::<u32>().map_err(|_| EngineError::invalid("slide id must be an unsigned integer string"))?;
        let slide = doc.doc.slides.iter().find(|slide| slide.id.0 == slide_id).ok_or_else(|| EngineError::new("NOT_FOUND", format!("slide {slide_id} was not found"), false))?;
        let ctx = deckcraft_model::resolve::Ctx::for_slide(&doc.doc, slide);
        let ids: Vec<u32> = serde_json::from_str(selected_ids_json).map_err(|error| EngineError::invalid(format!("invalid selected shape ids: {error}")))?;
        Ok(json!(ids.iter().filter_map(|id| slide.shape(ShapeId(*id))).map(|shape| { let rect = projected_xfrm(ctx.as_ref(), shape); json!({"id":shape.id.0.to_string(),"rect":rect.map(|rect|[rect.x,rect.y,rect.w,rect.h]),"rotation":rect.map(|rect|rect.rot),"flipH":rect.map(|rect|rect.flip_h),"flipV":rect.map(|rect|rect.flip_v)}) }).collect::<Vec<_>>()))
    }

    pub fn selection_projection(&self) -> EngineResult<Value> {
        let doc = self.document()?;
        let slide_id = doc
            .doc
            .slides
            .get(doc.selection.slide)
            .map(|slide| slide.id.0.to_string());
        let marquee = self.session.tool.marquee.map(|rect| [rect.x0, rect.y0, rect.width(), rect.height()]);
        let caret_line = doc.selection.text.as_ref()
            .and_then(|text| deckcraft_engine::cmd::text::caret_line(doc, text))
            .map(|(start, end)| [start.x, start.y, end.x, end.y]);
        Ok(json!({"slideId": slide_id, "shapeIds": doc.selection.shapes.iter().map(|id| id.0.to_string()).collect::<Vec<_>>(),
            "textSelection": doc.selection.text, "cells": doc.selection.cells.map(|(table, from, to)| json!([table.0.to_string(), [from.0, from.1], [to.0, to.1]])), "caretLine": caret_line, "isComposing": doc.composition.is_some(), "marquee": marquee}))
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
        let rendered = localized_render_document(&doc.doc, index, self.locale);
        let opacity_state = |shape_id| deckcraft_render::ShapeState { opacity: rendered.slides.get(index)
            .and_then(|slide| deckcraft_model::find_shape(&slide.shapes, shape_id))
            .map(element_opacity).unwrap_or(1.0), ..Default::default() };
        let image = render_slide(
            &rendered,
            index,
            &RenderOpts {
                scale,
                edit: true,
                state: Some(&opacity_state),
                ..Default::default()
            },
        );
        Ok(Frame {
            width: image.width,
            height: image.height,
            pixels: image.pixels,
        })
    }

    /// Render the same slide on a transparent, enlarged viewport. The offset keeps slide space
    /// aligned with the normal frame while allowing the renderer to expose objects past its edge.
    pub fn render_slide_overflow(&self, slide_id: &str, scale: f64, margin: f64) -> EngineResult<Frame> {
        let doc = self.document()?;
        let id = slide_id
            .parse::<u32>()
            .map_err(|_| EngineError::invalid("slide id must be an unsigned integer string"))?;
        let index = doc.doc.slides.iter().position(|slide| slide.id.0 == id).ok_or_else(|| {
            EngineError::new("NOT_FOUND", format!("slide {slide_id} was not found"), false)
        })?;
        let scale = if scale.is_finite() { scale.clamp(0.1, 2.0) } else { 1.0 };
        // Bound the temporary transparent RGBA frame to 4096x4096 (64 MiB). This
        // permits a viewport-derived margin without allowing a pan/zoom state to
        // request unbounded WASM and Canvas allocations.
        let requested_margin = if margin.is_finite() { margin.max(0.0) } else { 120.0 };
        let max_margin = ((4096.0 / scale - doc.doc.slide_size.width.max(doc.doc.slide_size.height)) / 2.0).max(0.0);
        let margin = requested_margin.min(max_margin);
        let width = ((doc.doc.slide_size.width + margin * 2.0) * scale).round().clamp(1.0, 4096.0) as u32;
        let height = ((doc.doc.slide_size.height + margin * 2.0) * scale).round().clamp(1.0, 4096.0) as u32;
        let rendered = localized_render_document(&doc.doc, index, self.locale);
        let opacity_state = |shape_id| deckcraft_render::ShapeState { opacity: rendered.slides.get(index)
            .and_then(|slide| deckcraft_model::find_shape(&slide.shapes, shape_id))
            .map(element_opacity).unwrap_or(1.0), ..Default::default() };
        let image = render_slide(
            &rendered,
            index,
            &RenderOpts {
                scale,
                state: Some(&opacity_state),
                offset: (margin * scale, margin * scale),
                size: Some((width, height)),
                edit: true,
                transparent_background: true,
                ..Default::default()
            },
        );
        Ok(Frame { width: image.width, height: image.height, pixels: image.pixels })
    }

    /// Prepare a compositor preview from the real Rust document: a background raster with the
    /// selected shapes omitted, plus a transparent raster containing only those shapes.
    pub fn render_move_preview(&self, slide_id: &str, scale: f64, margin: f64, selected_ids_json: &str) -> EngineResult<MovePreviewFrames> {
        let doc = self.document()?;
        let id = slide_id.parse::<u32>().map_err(|_| EngineError::invalid("slide id must be an unsigned integer string"))?;
        let index = doc.doc.slides.iter().position(|slide| slide.id.0 == id).ok_or_else(|| EngineError::new("NOT_FOUND", format!("slide {slide_id} was not found"), false))?;
        let selected_ids: Vec<u32> = serde_json::from_str(selected_ids_json).map_err(|error| EngineError::invalid(format!("invalid selected shape ids: {error}")))?;
        if selected_ids.is_empty() || selected_ids.len() > 1000 {
            return Err(EngineError::invalid("move preview requires 1 to 1000 selected shapes"));
        }
        let selected: Vec<ShapeId> = selected_ids.iter().copied().map(ShapeId).collect();
        let slide = &doc.doc.slides[index];
        if selected.iter().any(|shape_id| slide.shape(*shape_id).is_none()) {
            return Err(EngineError::invalid("move preview contains a shape not present on the active slide"));
        }
        let all_shapes: Vec<ShapeId> = slide.shapes.iter().map(|shape| shape.id).collect();
        let background_skip: Vec<ShapeId> = selected.clone();
        let foreground_skip: Vec<ShapeId> = all_shapes.into_iter().filter(|shape_id| !selected.contains(shape_id)).collect();
        let active_scale = if scale.is_finite() { scale.clamp(0.1, 4.0) } else { 1.0 };
        let overflow_scale = active_scale.min(2.0);
        let requested_margin = if margin.is_finite() { margin.max(0.0) } else { 120.0 };
        let max_margin = ((4096.0 / overflow_scale - doc.doc.slide_size.width.max(doc.doc.slide_size.height)) / 2.0).max(0.0);
        let margin = requested_margin.min(max_margin);
        let width = ((doc.doc.slide_size.width + margin * 2.0) * overflow_scale).round().clamp(1.0, 4096.0) as u32;
        let height = ((doc.doc.slide_size.height + margin * 2.0) * overflow_scale).round().clamp(1.0, 4096.0) as u32;
        let rendered = localized_render_document(&doc.doc, index, self.locale);
        let opacity_state = |shape_id| deckcraft_render::ShapeState { opacity: rendered.slides.get(index)
            .and_then(|slide| deckcraft_model::find_shape(&slide.shapes, shape_id))
            .map(element_opacity).unwrap_or(1.0), ..Default::default() };
        let active = render_slide(&rendered, index, &RenderOpts { scale: active_scale, edit: true, state: Some(&opacity_state), skip: &background_skip, ..Default::default() });
        let overflow = render_slide(&rendered, index, &RenderOpts { scale: overflow_scale, offset: (margin * overflow_scale, margin * overflow_scale), size: Some((width, height)), edit: true, state: Some(&opacity_state), transparent_background: true, skip: &background_skip, ..Default::default() });
        let selected_frame = render_slide_part(&rendered, index, SlidePart::Content, &RenderOpts { scale: overflow_scale, offset: (margin * overflow_scale, margin * overflow_scale), size: Some((width, height)), edit: true, state: Some(&opacity_state), transparent_background: true, skip: &foreground_skip, ..Default::default() });
        let selected_active_frame = render_slide_part(&rendered, index, SlidePart::Content, &RenderOpts { scale: active_scale, edit: true, state: Some(&opacity_state), transparent_background: true, skip: &foreground_skip, ..Default::default() });
        Ok(MovePreviewFrames {
            active_background: Frame { width: active.width, height: active.height, pixels: active.pixels },
            overflow_background: Frame { width: overflow.width, height: overflow.height, pixels: overflow.pixels },
            selected_shapes: Frame { width: selected_frame.width, height: selected_frame.height, pixels: selected_frame.pixels },
            selected_active_shapes: Frame { width: selected_active_frame.width, height: selected_active_frame.height, pixels: selected_active_frame.pixels },
        })
    }

    /// Re-render only selected objects from their current document geometry. Used while resizing
    /// text boxes so glyphs reflow instead of being stretched as part of a cached bitmap.
    pub fn render_selected_preview(&self, slide_id: &str, scale: f64, margin: f64, text_scale: f64, selected_ids_json: &str) -> EngineResult<SelectedPreviewFrames> {
        let doc = self.document()?;
        let id = slide_id.parse::<u32>().map_err(|_| EngineError::invalid("slide id must be an unsigned integer string"))?;
        let index = doc.doc.slides.iter().position(|slide| slide.id.0 == id).ok_or_else(|| EngineError::new("NOT_FOUND", format!("slide {slide_id} was not found"), false))?;
        let selected_ids: Vec<u32> = serde_json::from_str(selected_ids_json).map_err(|error| EngineError::invalid(format!("invalid selected shape ids: {error}")))?;
        if selected_ids.is_empty() || selected_ids.len() > 1000 {
            return Err(EngineError::invalid("selected preview requires 1 to 1000 selected shapes"));
        }
        let selected: Vec<ShapeId> = selected_ids.iter().copied().map(ShapeId).collect();
        let slide = &doc.doc.slides[index];
        if selected.iter().any(|shape_id| slide.shape(*shape_id).is_none()) {
            return Err(EngineError::invalid("selected preview contains a shape not present on the active slide"));
        }
        let skip: Vec<ShapeId> = slide.shapes.iter().map(|shape| shape.id).filter(|shape_id| !selected.contains(shape_id)).collect();
        let active_scale = if scale.is_finite() { scale.clamp(0.1, 4.0) } else { 1.0 };
        let overflow_scale = active_scale.min(2.0);
        let requested_margin = if margin.is_finite() { margin.max(0.0) } else { 120.0 };
        let max_margin = ((4096.0 / overflow_scale - doc.doc.slide_size.width.max(doc.doc.slide_size.height)) / 2.0).max(0.0);
        let margin = requested_margin.min(max_margin);
        let width = ((doc.doc.slide_size.width + margin * 2.0) * overflow_scale).round().clamp(1.0, 4096.0) as u32;
        let height = ((doc.doc.slide_size.height + margin * 2.0) * overflow_scale).round().clamp(1.0, 4096.0) as u32;
        let mut rendered = localized_render_document(&doc.doc, index, self.locale);
        let text_scale = if text_scale.is_finite() { text_scale.clamp(0.1, 10.0) } else { 1.0 };
        if (text_scale - 1.0).abs() > 0.001 {
            let scaled = selected.iter().filter_map(|shape_id| {
                scaled_text_body(&rendered, index, *shape_id, text_scale).map(|body| (*shape_id, body))
            }).collect::<Vec<_>>();
            if let Some(slide) = rendered.slides.get_mut(index) {
                let slide = std::sync::Arc::make_mut(slide);
                for (shape_id, body) in scaled {
                    if let Some(shape) = slide.shapes.iter_mut().find(|shape| shape.id == shape_id) {
                        shape.text = Some(body);
                    }
                }
            }
        }
        let opacity_state = |shape_id| deckcraft_render::ShapeState { opacity: rendered.slides.get(index)
            .and_then(|slide| deckcraft_model::find_shape(&slide.shapes, shape_id))
            .map(element_opacity).unwrap_or(1.0), ..Default::default() };
        let selected = render_slide_part(&rendered, index, SlidePart::Content, &RenderOpts { scale: overflow_scale, offset: (margin * overflow_scale, margin * overflow_scale), size: Some((width, height)), edit: true, state: Some(&opacity_state), transparent_background: true, skip: &skip, ..Default::default() });
        let selected_active = render_slide_part(&rendered, index, SlidePart::Content, &RenderOpts { scale: active_scale, edit: true, state: Some(&opacity_state), transparent_background: true, skip: &skip, ..Default::default() });
        Ok(SelectedPreviewFrames {
            selected_shapes: Frame { width: selected.width, height: selected.height, pixels: selected.pixels },
            selected_active_shapes: Frame { width: selected_active.width, height: selected_active.height, pixels: selected_active.pixels },
        })
    }

    pub fn export_pptx(&self) -> EngineResult<Vec<u8>> {
        let mut presentation = self.document()?.doc.as_ref().clone();
        bake_element_opacity(&mut presentation);
        deckcraft_pptx::export(&presentation)
            .map_err(|error| EngineError::engine(error.to_string()))
    }

    pub fn import_pptx(&mut self, bytes: &[u8]) -> EngineResult<Value> {
        let mut presentation = deckcraft_pptx::import(bytes)
            .map_err(|error| EngineError::new("IMPORT_ERROR", error.to_string(), false))?;
        unbake_element_opacity(&mut presentation);
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

    #[cfg(test)]
    pub fn regression_diagnostics(&self) -> EngineResult<Value> {
        let doc = self.document()?;
        Ok(json!({
            "clipboard": {
                "shapes": self.session.clipboard.shapes.len(),
                "plain": self.session.clipboard.plain,
                "pastes": self.session.clipboard.pastes,
            },
            "duplicateOffset": self.session.prefs.duplicate_offset,
            "undoEntries": doc.history.undo.len(),
            "redoEntries": doc.history.redo.len(),
            "journalTail": self.session.journal.last(),
        }))
    }
}

#[cfg(target_arch = "wasm32")]
mod wasm_api {
    use super::{Engine, EngineError};
    use js_sys::Uint8Array;
    use serde::Serialize;
    use wasm_bindgen::prelude::*;

    fn js_error(error: EngineError) -> JsValue {
        serde_wasm_bindgen::to_value(&error).unwrap_or_else(|_| JsValue::from_str("{\"code\":\"SERIALIZATION_ERROR\",\"message\":\"Could not serialize engine error\",\"retryable\":false}"))
    }
    fn js_value(value: serde_json::Value) -> Result<JsValue, EngineError> {
        value
            .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
            .map_err(|error| EngineError::new("SERIALIZATION_ERROR", error.to_string(), false))
    }

    #[wasm_bindgen]
    pub struct FolioSession {
        engine: Engine,
    }

    #[wasm_bindgen(js_name = engineRevision)]
    pub fn engine_revision() -> String {
        env!("DECKCRAFT_REVISION").to_owned()
    }

    #[wasm_bindgen(js_name = createSession)]
    pub fn create_session() -> FolioSession {
        FolioSession {
            engine: Engine::create_session(),
        }
    }

    #[wasm_bindgen]
    impl FolioSession {
        #[wasm_bindgen(js_name = setInkTool)]
        pub fn set_ink_tool(&mut self, mode: &str) -> Result<(), JsValue> {
            self.engine.set_ink_tool(mode).map_err(js_error)
        }
        #[wasm_bindgen(js_name = setSelectTool)]
        pub fn set_select_tool(&mut self) {
            self.engine.set_select_tool();
        }
        #[wasm_bindgen(js_name = createBlankSlide)]
        pub fn create_blank_slide(&mut self) -> Result<JsValue, JsValue> {
            self.engine
                .create_blank_slide()
                .and_then(js_value)
                .map_err(js_error)
        }
        pub fn execute(&mut self, command: &str, params_json: &str) -> Result<JsValue, JsValue> {
            self.engine
                .execute(command, params_json)
                .and_then(js_value)
                .map_err(js_error)
        }
        #[wasm_bindgen(js_name = setLocale)]
        pub fn set_locale(&mut self, locale: &str) -> Result<(), JsValue> {
            self.engine.set_locale(locale);
            Ok(())
        }
        #[wasm_bindgen(js_name = getFontFamilies)]
        pub fn get_font_families(&self) -> Result<JsValue, JsValue> {
            js_value(serde_json::json!(self.engine.font_families())).map_err(js_error)
        }
        #[wasm_bindgen(js_name = getMediaBytes)]
        pub fn get_media_bytes(&self, shape_id: &str) -> Result<Uint8Array, JsValue> {
            self.engine.get_media_bytes(shape_id).map(|bytes| Uint8Array::from(bytes.as_slice())).map_err(js_error)
        }
        #[wasm_bindgen(js_name = typeText)]
        pub fn type_text(&mut self, text: &str) -> Result<JsValue, JsValue> {
            self.engine.type_text(text).and_then(js_value).map_err(js_error)
        }
        #[wasm_bindgen(js_name = insertShapesBatch)]
        pub fn insert_shapes_batch(&mut self, payload_json: &str) -> Result<JsValue, JsValue> {
            self.engine
                .insert_shapes_batch(payload_json)
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
        #[wasm_bindgen(js_name = hitTest)]
        pub fn hit_test(&self, x: f64, y: f64, tolerance: f64) -> Result<JsValue, JsValue> {
            self.engine.hit_test(x, y, tolerance).and_then(js_value).map_err(js_error)
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
        #[wasm_bindgen(js_name = wasmMemoryBytes)]
        pub fn wasm_memory_bytes(&self) -> Result<u32, JsValue> {
            let memory = wasm_bindgen::memory();
            let buffer = js_sys::Reflect::get(&memory, &"buffer".into())?;
            let bytes = js_sys::Reflect::get(&buffer, &"byteLength".into())?
                .as_f64()
                .ok_or_else(|| JsValue::from_str("WebAssembly memory byteLength was unavailable"))?;
            Ok(bytes as u32)
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
        #[wasm_bindgen(js_name = getSelectedShapeGeometry)]
        pub fn get_selected_shape_geometry(&self, slide_id: &str, selected_ids_json: &str) -> Result<JsValue, JsValue> {
            self.engine.selected_shape_geometry(slide_id, selected_ids_json).and_then(js_value).map_err(js_error)
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
        #[wasm_bindgen(js_name = renderSlideOverflow)]
        pub fn render_slide_overflow(&self, slide_id: &str, scale: f64, margin: f64) -> Result<JsValue, JsValue> {
            let frame = self.engine.render_slide_overflow(slide_id, scale, margin).map_err(js_error)?;
            let pixels = Uint8Array::from(frame.pixels.as_slice());
            let object = js_sys::Object::new();
            js_sys::Reflect::set(&object, &"width".into(), &frame.width.into())?;
            js_sys::Reflect::set(&object, &"height".into(), &frame.height.into())?;
            js_sys::Reflect::set(&object, &"pixels".into(), &pixels)?;
            Ok(object.into())
        }
        #[wasm_bindgen(js_name = renderMovePreview)]
        pub fn render_move_preview(&self, slide_id: &str, scale: f64, margin: f64, selected_ids_json: &str) -> Result<JsValue, JsValue> {
            let frames = self.engine.render_move_preview(slide_id, scale, margin, selected_ids_json).map_err(js_error)?;
            let result = js_sys::Object::new();
            for (name, frame) in [
                ("activeBackground", frames.active_background),
                ("overflowBackground", frames.overflow_background),
                ("selectedShapes", frames.selected_shapes),
                ("selectedActiveShapes", frames.selected_active_shapes),
            ] {
                let pixels = Uint8Array::from(frame.pixels.as_slice());
                let object = js_sys::Object::new();
                js_sys::Reflect::set(&object, &"width".into(), &frame.width.into())?;
                js_sys::Reflect::set(&object, &"height".into(), &frame.height.into())?;
                js_sys::Reflect::set(&object, &"pixels".into(), &pixels)?;
                js_sys::Reflect::set(&result, &name.into(), &object)?;
            }
            Ok(result.into())
        }
        #[wasm_bindgen(js_name = renderSelectedPreview)]
        pub fn render_selected_preview(&self, slide_id: &str, scale: f64, margin: f64, text_scale: f64, selected_ids_json: &str) -> Result<JsValue, JsValue> {
            let frames = self.engine.render_selected_preview(slide_id, scale, margin, text_scale, selected_ids_json).map_err(js_error)?;
            let result = js_sys::Object::new();
            for (name, frame) in [
                ("selectedShapes", frames.selected_shapes),
                ("selectedActiveShapes", frames.selected_active_shapes),
            ] {
                let pixels = Uint8Array::from(frame.pixels.as_slice());
                let object = js_sys::Object::new();
                js_sys::Reflect::set(&object, &"width".into(), &frame.width.into())?;
                js_sys::Reflect::set(&object, &"height".into(), &frame.height.into())?;
                js_sys::Reflect::set(&object, &"pixels".into(), &pixels)?;
                js_sys::Reflect::set(&result, &name.into(), &object)?;
            }
            Ok(result.into())
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
        #[cfg(test)]
        #[wasm_bindgen(js_name = regressionDiagnostics)]
        pub fn regression_diagnostics(&self) -> Result<JsValue, JsValue> {
            self.engine
                .regression_diagnostics()
                .and_then(js_value)
                .map_err(js_error)
        }
        #[cfg(test)]
        #[wasm_bindgen(js_name = seedRegressionClipboard)]
        pub fn seed_regression_clipboard(&mut self) -> Result<(), JsValue> {
            self.engine.session.clipboard.plain = "folio-regression-clipboard".into();
            self.engine.session.prefs.duplicate_offset = 37.0;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Engine, EditorLocale, localized_render_document};
    use serde_json::json;

    #[test]
    fn applying_template_inserts_styled_slides_after_current_in_one_undo_step() {
        let mut engine = Engine::create_session();
        let template = json!({
            "backgrounds": ["#FFF9F5", "#FFFFFF"],
            "accent": "#557B75",
            "slides": [
                {"title":"Template cover", "bullets":["Presenter"], "layout":"title"},
                {"title":"Template details", "bullets":["First point", "Second point"], "layout":"two-column"}
            ]
        });
        assert!(engine.execute("presentation.applyTemplate", &template.to_string()).is_ok());
        let doc = engine.session.doc().ok();
        assert_eq!(doc.map(|state| state.doc.slides.len()), Some(3));
        assert_eq!(doc.map(|state| state.selection.slide), Some(1));
        assert!(doc.is_some_and(|state| state.doc.slides[1].shapes.iter().any(|shape| shape.text.as_ref().is_some_and(|text| text.text().contains("Template cover")))));
        assert!(doc.is_some_and(|state| state.doc.slides[1].background.is_some()));
        assert!(doc.is_some_and(|state| state.doc.slides[1].shapes.iter().any(|shape| shape.decorative && shape.name == "Şablon vurgu şeridi")));
        assert!(doc.is_some_and(|state| state.doc.slides[2].shapes.iter().any(|shape| shape.decorative && shape.name == "Şablon vurgu çizgisi")));
        assert!(engine.undo().is_ok());
        assert_eq!(engine.session.doc().ok().map(|state| state.doc.slides.len()), Some(1));
        assert!(engine.redo().is_ok());
        assert_eq!(engine.session.doc().ok().map(|state| state.doc.slides.len()), Some(3));
        assert!(engine.session.doc().ok().is_some_and(|state| state.doc.slides[1].shapes.iter().any(|shape| shape.decorative && shape.name == "Şablon vurgu şeridi")));
    }

    #[test]
    fn presentation_rename_uses_document_properties_and_supports_undo_redo() {
        let mut engine = Engine::create_session();
        assert!(engine.execute("file.properties", r#"{"title":"Canva Benzerlik Kontrolü"}"#).is_ok());
        assert_eq!(engine.summary().ok().and_then(|summary| summary["title"].as_str().map(str::to_owned)).as_deref(), Some("Canva Benzerlik Kontrolü"));
        assert!(engine.undo().is_ok());
        assert_ne!(engine.summary().ok().and_then(|summary| summary["title"].as_str().map(str::to_owned)).as_deref(), Some("Canva Benzerlik Kontrolü"));
        assert!(engine.redo().is_ok());
        assert_eq!(engine.summary().ok().and_then(|summary| summary["title"].as_str().map(str::to_owned)).as_deref(), Some("Canva Benzerlik Kontrolü"));
    }

    #[test]
    fn pointer_updates_project_deckcraft_smart_guides_until_release() {
        let mut engine = Engine::create_session();
        assert!(engine.execute("shape.insert", r#"{"preset":"rect","rect":[10,10,100,100]}"#).is_ok());
        assert!(engine.execute("shape.insert", r#"{"preset":"rect","rect":[300,200,100,100]}"#).is_ok());

        assert!(engine.pointer("down", 350.0, 250.0, "{}").is_ok());
        let drag = engine.pointer("drag", 160.0, 250.0, "{}");
        assert!(drag.as_ref().is_ok_and(|update| update["toolGuides"].as_array().is_some_and(|guides| {
            guides.iter().any(|guide| guide["vertical"] == true && (guide["pos"].as_f64().unwrap_or_default() - 110.0).abs() < 0.01)
        })), "moving a shape onto a neighbor edge must expose the active vertical smart guide: {drag:?}");

        let released = engine.pointer("up", 160.0, 250.0, "{}");
        assert!(released.as_ref().is_ok_and(|update| update["toolGuides"].as_array().is_some_and(Vec::is_empty)));
    }

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
        assert!(first.insert_shapes_batch(&json!({"shapes":shapes,"media":[]}).to_string()).is_ok());
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
    fn manual_text_box_resize_keeps_the_dragged_frame_and_undoes_as_one_step() {
        let mut engine = Engine::create_session();
        assert!(engine.execute("slide.new", r#"{"layout":"blank"}"#).is_ok());
        let inserted = engine.execute(
            "insert.textBox",
            r#"{"rect":[200,150,240,60],"text":"TAYFUR ÇINAR"}"#,
        );
        let Some(id) = inserted
            .ok()
            .and_then(|value| value["result"]["id"].as_u64())
            .map(|id| super::ShapeId(id as u32))
        else {
            panic!("text box id missing")
        };
        {
            let state = engine.session.doc_mut().unwrap();
            let mut document = (*state.doc).clone();
            let slide_index = state.selection.slide;
            let shape = std::sync::Arc::make_mut(&mut document.slides[slide_index])
                .shapes
                .iter_mut()
                .find(|shape| shape.id == id)
                .unwrap();
            let paragraph = shape.text.as_mut().unwrap().paragraphs.first_mut().unwrap();
            paragraph.runs = vec![
                deckcraft_model::text::Run::with(
                    "TAYFUR ",
                    deckcraft_model::text::RunProps { size: Some(12.0), ..Default::default() },
                ),
                deckcraft_model::text::Run::with(
                    "ÇINAR",
                    deckcraft_model::text::RunProps { size: Some(30.0), ..Default::default() },
                ),
            ];
            state.doc = std::sync::Arc::new(document);
        }
        let before = engine.session.doc().ok().and_then(|doc| doc.shape(id).and_then(|shape| shape.xfrm));
        let Some(before) = before else { panic!("text box geometry missing") };
        assert!(engine.session.doc().is_ok_and(|doc| doc.shape(id).and_then(|shape| shape.text.as_ref())
            .is_some_and(|text| text.body.autofit == Some(deckcraft_model::text::AutoFit::None))));
        let initial_sizes = [12.0, 30.0];
        let side_x = before.x + before.w;
        let side_y = before.y + before.h / 2.0;
        assert!(engine.pointer("down", side_x, side_y, "{}").is_ok());
        assert!(engine.pointer("drag", side_x + 40.0, side_y, "{}").is_ok());
        let side_dragged = engine.session.doc().ok().and_then(|doc| doc.shape(id).and_then(|shape| shape.xfrm));
        assert!(engine.pointer("up", side_x + 40.0, side_y, "{}").is_ok());
        assert_eq!(engine.session.doc().ok().and_then(|doc| doc.shape(id).and_then(|shape| shape.xfrm)), side_dragged);
        assert!(engine.session.doc().is_ok_and(|doc| doc.shape(id).and_then(|shape| shape.text.as_ref())
            .is_some_and(|text| text.paragraphs.first().is_some_and(|paragraph| paragraph.runs.iter()
                .filter_map(|run| run.props.size).collect::<Vec<_>>() == initial_sizes))));
        assert!(engine.undo().is_ok());
        assert_eq!(engine.session.doc().ok().and_then(|doc| doc.shape(id).and_then(|shape| shape.xfrm)), Some(before));
        assert!(engine.redo().is_ok());
        assert_eq!(engine.session.doc().ok().and_then(|doc| doc.shape(id).and_then(|shape| shape.xfrm)), side_dragged);
        assert!(engine.session.doc().is_ok_and(|doc| doc.shape(id).and_then(|shape| shape.text.as_ref())
            .is_some_and(|text| text.body.autofit == Some(deckcraft_model::text::AutoFit::None))));

        assert!(engine.undo().is_ok());
        for (handle, handle_x, handle_y, drag_x, drag_y) in [
            (0, before.x, before.y, before.x - 40.0, before.y - 12.0),
            (1, before.x + before.w / 2.0, before.y, before.x + before.w / 2.0, before.y - 40.0),
            (2, before.x + before.w, before.y, before.x + before.w + 40.0, before.y - 12.0),
            (4, before.x + before.w, before.y + before.h, before.x + before.w + 40.0, before.y + before.h + 12.0),
            (5, before.x + before.w / 2.0, before.y + before.h, before.x + before.w / 2.0, before.y + before.h + 40.0),
            (6, before.x, before.y + before.h, before.x - 40.0, before.y + before.h + 12.0),
        ] {
            assert!(matches!(engine.session.hit_test(deckcraft_engine::geom::Point::new(handle_x, handle_y), 4.0),
                Some(deckcraft_engine::tools::Hit::Resize { id: hit_id, handle: hit }) if hit_id == id && hit == handle),
                "test pointer must target hidden text-box resize handle {handle}");
            assert!(engine.pointer("down", handle_x, handle_y, "{}").is_ok());
            assert!(engine.pointer("drag", drag_x, drag_y, "{}").is_ok());
            assert!(engine.pointer("up", drag_x, drag_y, "{}").is_ok());
            assert_eq!(engine.session.doc().ok().and_then(|doc| doc.shape(id).and_then(|shape| shape.xfrm)), Some(before),
                "Canva-style text boxes must resize only from their left and right handles");
        }
    }

    #[test]
    fn drawn_text_box_preserves_the_pointer_sized_frame_with_single_step_undo_redo() {
        let mut engine = Engine::create_session();
        assert!(engine.execute("slide.new", r#"{"layout":"blank"}"#).is_ok());
        let inserted = engine.execute("insert.textBox", r#"{"rect":[134.4,97.2,374.4,135.0],"text":""}"#).unwrap();
        let id = inserted["result"]["id"].as_u64().map(|id| deckcraft_model::ShapeId(id as u32)).unwrap();
        let shape_rect = |engine: &Engine| {
            engine.session.doc().ok()?.current_slide()?.shapes.iter().find(|shape| shape.id == id).and_then(|shape| shape.xfrm)
        };
        let rect = shape_rect(&engine).unwrap();
        assert!((rect.w - 374.4).abs() < 0.01);
        assert!((rect.h - 135.0).abs() < 0.01);
        assert!(engine.execute("edit.undo", "{}").is_ok());
        assert!(shape_rect(&engine).is_none());
        assert!(engine.execute("edit.redo", "{}").is_ok());
        let redone = shape_rect(&engine).unwrap();
        assert!((redone.w - 374.4).abs() < 0.01);
        assert!((redone.h - 135.0).abs() < 0.01);
    }

    #[test]
    fn default_slide_projects_inherited_placeholder_geometry() {
        let engine = Engine::create_session();
        let summary = engine.summary();
        let Some(slide_id) = summary.ok().and_then(|v| v["slides"][0]["id"].as_str().map(str::to_owned)) else {
            panic!("default slide id missing")
        };
        let projection = engine.slide_projection(&slide_id);
        assert!(projection.is_ok_and(|value| {
            let shapes = value["shapes"].as_array();
            shapes.is_some_and(|shapes| {
                let title = shapes.iter().find(|shape| shape["name"] == "Title 1");
                let subtitle = shapes.iter().find(|shape| shape["name"] == "Subtitle 2");
                title.is_some_and(|shape| shape["rect"].as_array().is_some_and(|r| r.len() == 4 && r[2].as_f64().is_some_and(|w| w > 0.0)))
                    && subtitle.is_some_and(|shape| shape["rect"].as_array().is_some_and(|r| r.len() == 4 && r[2].as_f64().is_some_and(|w| w > 0.0)))
            })
        }));
    }

    #[test]
    fn localized_prompts_are_render_projection_only_and_respect_custom_prompts() {
        let engine = Engine::create_session();
        let Some(state) = engine.session.doc().ok() else { panic!("new Rust Session has no presentation") };
        let slide_index = state.selection.slide;
        let slide_id = state.doc.slides[slide_index].id;
        let original = localized_render_document(&state.doc, slide_index, EditorLocale::Turkish);
        let Some((_, layout)) = original.layout(state.doc.slides[slide_index].layout) else { panic!("default slide layout missing") };
        let title = layout.shapes.iter().find(|shape| shape.name == "Title 1");
        assert!(title.is_some_and(|shape| shape.ph.as_ref().is_some_and(|ph| ph.has_custom_prompt)
            && shape.text.as_ref().is_some_and(|text| text.text() == "Başlık eklemek için tıklayın")));
        let english = localized_render_document(&state.doc, slide_index, EditorLocale::English);
        let Some((_, english_layout)) = english.layout(state.doc.slides[slide_index].layout) else { panic!("default slide layout missing") };
        let english_title = english_layout.shapes.iter().find(|shape| shape.name == "Title 1");
        assert!(english_title.is_some_and(|shape| shape.text.as_ref().is_some_and(|text| text.text() == "Click to add title")));
        assert!(!state.doc.layout(state.doc.slides[slide_index].layout).is_some_and(|(_, layout)| layout.shapes.iter()
            .find(|shape| shape.name == "Title 1").and_then(|shape| shape.ph.as_ref()).is_some_and(|ph| ph.has_custom_prompt)));
        let mut custom_document = state.doc.as_ref().clone();
        let mut custom_set = false;
        for master in &mut custom_document.masters {
            let master = std::sync::Arc::make_mut(master);
            let Some(layout) = master.layouts.iter_mut().find(|layout| layout.id == state.doc.slides[slide_index].layout) else { continue };
            let Some(shape) = layout.shapes.iter_mut().find(|shape| shape.name == "Title 1") else { continue };
            if let Some(placeholder) = shape.ph.as_mut() { placeholder.has_custom_prompt = true; }
            shape.text = Some(deckcraft_model::text::TextBody::from_text("Custom title prompt"));
            custom_set = true;
            break;
        }
        assert!(custom_set);
        let preserved = localized_render_document(&custom_document, slide_index, EditorLocale::Turkish);
        let Some((_, preserved_layout)) = preserved.layout(state.doc.slides[slide_index].layout) else { panic!("custom prompt layout missing") };
        let preserved_title = preserved_layout.shapes.iter().find(|shape| shape.name == "Title 1");
        assert!(preserved_title.is_some_and(|shape| shape.text.as_ref().is_some_and(|text| text.text() == "Custom title prompt")));
        assert_eq!(state.doc.slides[slide_index].id, slide_id);
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
        assert!(engine.insert_shapes_batch(r#"{"shapes":[],"media":[]}"#).is_err());
        assert!(
            engine
                .insert_shapes_batch(&" ".repeat(super::MAX_BATCH_BYTES + 1))
                .is_err()
        );
    }

    #[test]
    fn element_opacity_projects_renders_undoes_and_round_trips_in_pptx() {
        let mut engine = Engine::create_session();
        assert!(engine.execute("slide.new", r#"{"layout":"blank"}"#).is_ok());
        let inserted = engine.execute("shape.insert", r#"{"preset":"rect","rect":[80,80,220,120]}"#);
        let Some(id) = inserted.ok().and_then(|value| value["result"]["id"].as_u64()) else { panic!("inserted shape id missing") };
        let slide_id = engine.summary().ok().and_then(|value| value["slides"][1]["id"].as_str().map(str::to_owned));
        let Some(slide_id) = slide_id else { panic!("active slide id missing") };
        let original = engine.render_slide(&slide_id, 1.0).ok().map(|frame| frame.pixels[(130 * frame.width as usize + 180) * 4..(130 * frame.width as usize + 180) * 4 + 4].to_vec());
        let params = json!({"ids":[id],"opacity":0.4});
        assert!(engine.set_element_opacity(&params, false).is_ok());
        assert!(engine.set_element_opacity(&params, true).is_ok());
        let projection = engine.slide_projection(&slide_id);
        assert_eq!(projection.ok().and_then(|value| value["shapes"][0]["elementOpacity"].as_f64()), Some(0.4));
        let faded = engine.render_slide(&slide_id, 1.0).ok().map(|frame| frame.pixels[(130 * frame.width as usize + 180) * 4..(130 * frame.width as usize + 180) * 4 + 4].to_vec());
        assert!(original.zip(faded).is_some_and(|(before, after)| before != after), "renderer did not apply element opacity");
        assert!(engine.undo().is_ok());
        let undone = engine.slide_projection(&slide_id);
        assert_eq!(undone.ok().and_then(|value| value["shapes"][0]["elementOpacity"].as_f64()), Some(1.0));
        assert!(engine.redo().is_ok());
        let expected_round_trip_frame = engine.render_slide(&slide_id, 1.0).ok();
        let bytes = engine.export_pptx().ok();
        let raw_round_trip = bytes.as_deref().and_then(|bytes| deckcraft_pptx::import(bytes).ok());
        let round_trip_shape = raw_round_trip.as_ref().and_then(|presentation| presentation.slides.get(1))
            .and_then(|slide| slide.shapes.first());
        let contains_opacity_alpha = round_trip_shape.is_some_and(|shape| {
            let color_has_alpha = |color: &deckcraft_model::ColorRef| color.mods.iter().any(|transform|
                matches!(transform, deckcraft_model::ColorTransform::AlphaMod(value) if *value == 40_000));
            shape.style.as_ref().is_some_and(|style| color_has_alpha(&style.fill_ref.1) || color_has_alpha(&style.line_ref.1))
                || shape.fill.as_ref().is_some_and(|fill| match fill {
                    deckcraft_model::Fill::Solid { color } => color_has_alpha(color),
                    deckcraft_model::Fill::Gradient(gradient) => gradient.stops.iter().any(|stop| color_has_alpha(&stop.color)),
                    _ => false,
                })
        });
        assert!(contains_opacity_alpha, "PPTX output did not bake element opacity into shape fill/line alpha");
        let mut imported = Engine::create_session();
        assert!(bytes.as_deref().map(|bytes| imported.import_pptx(bytes)).is_some_and(|result| result.is_ok()));
        let imported_id = imported.summary().ok().and_then(|value| value["slides"][1]["id"].as_str().map(str::to_owned));
        let round_trip = imported_id.as_deref().and_then(|id| imported.slide_projection(id).ok());
        assert_eq!(round_trip.and_then(|value| value["shapes"][0]["elementOpacity"].as_f64()), Some(0.4));
        let imported_frame = imported_id.as_deref().and_then(|id| imported.render_slide(id, 1.0).ok());
        assert!(expected_round_trip_frame.zip(imported_frame).is_some_and(|(expected, actual)| expected.pixels == actual.pixels),
            "Folio PPTX re-open applied baked element opacity more than once");
        let text_inserted = engine.execute("insert.textBox", r#"{"rect":[320,80,220,100],"text":"Opacity text"}"#);
        let Some(text_id) = text_inserted.ok().and_then(|value| value["result"]["id"].as_u64()) else { panic!("inserted text shape id missing") };
        let opaque_text_frame = engine.render_slide(&slide_id, 1.0).ok();
        let text_params = json!({"ids":[text_id],"opacity":0.35});
        assert!(engine.set_element_opacity(&text_params, false).is_ok());
        assert!(engine.set_element_opacity(&text_params, true).is_ok());
        let faded_text_frame = engine.render_slide(&slide_id, 1.0).ok();
        let text_region_changed = opaque_text_frame.zip(faded_text_frame).is_some_and(|(before, after)| {
            let x0 = 315usize;
            let x1 = 545usize.min(before.width as usize);
            let y0 = 75usize;
            let y1 = 185usize.min(before.height as usize);
            (y0..y1).any(|y| (x0..x1).any(|x| {
                let offset = (y * before.width as usize + x) * 4;
                before.pixels.get(offset..offset + 4) != after.pixels.get(offset..offset + 4)
            }))
        });
        assert!(text_region_changed, "text opacity did not change rendered glyph pixels");
    }
}
