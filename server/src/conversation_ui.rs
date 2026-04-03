use ratatui::{
    Frame,
    layout::{Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
};

use crate::app::App;
use crate::conversation::MessageKind;

pub fn render(frame: &mut Frame, app: &App) {
    let chunks = Layout::vertical([
        Constraint::Length(1), // title bar
        Constraint::Min(1),   // messages
        Constraint::Length(1), // footer
    ])
    .split(frame.area());

    render_title(frame, app, chunks[0]);
    render_messages(frame, app, chunks[1]);
    render_footer(frame, app, chunks[2]);
}

fn render_title(frame: &mut Frame, app: &App, area: Rect) {
    let session = app
        .conversation_session_idx
        .and_then(|idx| app.sessions.get(idx));

    let title_spans = match session {
        Some(s) => {
            let mut spans = vec![
                Span::styled(" Conversation ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
                Span::styled("| ", Style::default().fg(Color::DarkGray)),
                Span::raw(&s.project_name),
            ];
            if let Some(b) = &s.branch {
                spans.push(Span::styled(" :: ", Style::default().fg(Color::DarkGray)));
                spans.push(Span::styled(b.as_str(), Style::default().fg(Color::Green)));
            }
            spans.push(Span::styled(" | ", Style::default().fg(Color::DarkGray)));
            let status_color = match s.status {
                crate::session::SessionStatus::Working => Color::Green,
                crate::session::SessionStatus::Input => Color::Yellow,
                crate::session::SessionStatus::Idle => Color::DarkGray,
                crate::session::SessionStatus::New => Color::Blue,
            };
            spans.push(Span::styled(s.status.label(), Style::default().fg(status_color)));
            // Append tier 3 overview if available
            if let Some(summary) = app.summary_for(&s.session_id) {
                if !summary.overview.is_empty() {
                    spans.push(Span::styled(" | ", Style::default().fg(Color::DarkGray)));
                    spans.push(Span::styled(
                        summary.overview.clone(),
                        Style::default().fg(Color::Rgb(140, 140, 160)),
                    ));
                }
            }
            spans
        }
        None => vec![Span::styled(" No session selected", Style::default().fg(Color::Red))],
    };

    let title = Paragraph::new(Line::from(title_spans))
        .style(Style::default().bg(Color::Rgb(30, 30, 40)));
    frame.render_widget(title, area);
}

fn render_messages(frame: &mut Frame, app: &App, area: Rect) {
    let session = match app
        .conversation_session_idx
        .and_then(|idx| app.sessions.get(idx))
    {
        Some(s) => s,
        None => {
            let empty = Paragraph::new("No conversation data.")
                .style(Style::default().fg(Color::DarkGray))
                .block(Block::default().borders(Borders::ALL));
            frame.render_widget(empty, area);
            return;
        }
    };

    // Filter messages based on toggle
    let messages: Vec<_> = session
        .messages
        .iter()
        .filter(|m| {
            if app.conversation_hide_tools {
                matches!(m.kind, MessageKind::UserText | MessageKind::AssistantText)
            } else {
                true
            }
        })
        .collect();

    if messages.is_empty() {
        let empty = Paragraph::new("  No messages yet.")
            .style(Style::default().fg(Color::DarkGray))
            .block(Block::default().borders(Borders::ALL).title(" Messages "));
        frame.render_widget(empty, area);
        return;
    }

    // Build display lines from messages
    let mut lines: Vec<Line> = Vec::new();

    for msg in &messages {
        let ts = format_short_time(&msg.timestamp);

        let (label, label_color, text_color) = match msg.kind {
            MessageKind::UserText => ("You   ", Color::Blue, Color::Blue),
            MessageKind::AssistantText => ("Claude", Color::White, Color::White),
            MessageKind::ToolCall => ("Tool  ", Color::Yellow, Color::Yellow),
            MessageKind::ToolResult => ("Output", Color::DarkGray, Color::DarkGray),
            MessageKind::Thinking => ("Think ", Color::Rgb(80, 80, 80), Color::Rgb(80, 80, 80)),
        };

        // First line: timestamp + label + start of content
        let mut spans = vec![
            Span::styled(
                format!(" {} ", ts),
                Style::default().fg(Color::DarkGray),
            ),
            Span::styled(
                format!("[{}] ", label.trim()),
                Style::default().fg(label_color).add_modifier(Modifier::BOLD),
            ),
        ];

        // For tool calls, show tool name badge
        if msg.kind == MessageKind::ToolCall {
            if let Some(ref name) = msg.tool_name {
                spans.push(Span::styled(
                    format!(" {} ", name),
                    Style::default()
                        .fg(Color::Black)
                        .bg(Color::Yellow),
                ));
                spans.push(Span::raw(" "));
            }
        }

        // Content: for assistant text, apply basic formatting
        let content = &msg.text;
        let content_lines: Vec<&str> = content.lines().collect();

        if content_lines.is_empty() {
            lines.push(Line::from(spans));
        } else {
            // First content line on same line as label
            let first = content_lines[0];
            let display_first = truncate_line(first, area.width.saturating_sub(30) as usize);
            spans.push(format_content_span(&display_first, text_color, &msg.kind));
            lines.push(Line::from(spans));

            // Additional content lines (indented)
            let max_extra = match msg.kind {
                MessageKind::AssistantText => 8,
                MessageKind::UserText => 4,
                MessageKind::ToolResult => 2,
                _ => 1,
            };
            for (i, line) in content_lines.iter().skip(1).enumerate() {
                if i >= max_extra {
                    lines.push(Line::from(vec![
                        Span::raw("              "),
                        Span::styled("...", Style::default().fg(Color::DarkGray)),
                    ]));
                    break;
                }
                let display = truncate_line(line, area.width.saturating_sub(16) as usize);
                lines.push(Line::from(vec![
                    Span::raw("              "), // indent to align with content
                    format_content_span(&display, text_color, &msg.kind),
                ]));
            }
        }

        // Separator line between messages
        lines.push(Line::from(""));
    }

    // Handle scrolling
    let visible_height = area.height.saturating_sub(2) as usize; // minus borders
    let total_lines = lines.len();
    let max_scroll = total_lines.saturating_sub(visible_height);

    // Clamp scroll — we can't mutate app here, so just clamp locally
    let scroll = app.conversation_scroll.min(max_scroll);

    let msg_count = messages.len();
    let total_count = session.messages.len();
    let block_title = if app.conversation_hide_tools {
        format!(" Messages ({}/{} shown, tools hidden) ", msg_count, total_count)
    } else {
        format!(" Messages ({}) ", total_count)
    };

    let paragraph = Paragraph::new(lines)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(block_title)
                .border_style(Style::default().fg(Color::DarkGray)),
        )
        .scroll((scroll as u16, 0))
        .wrap(Wrap { trim: false });

    frame.render_widget(paragraph, area);
}

fn render_footer(frame: &mut Frame, app: &App, area: Rect) {
    let tool_label = if app.conversation_hide_tools {
        "show tools"
    } else {
        "hide tools"
    };

    let spans = vec![
        Span::styled("j/k", Style::default().fg(Color::Cyan)),
        Span::raw(" scroll  "),
        Span::styled("g/G", Style::default().fg(Color::Cyan)),
        Span::raw(" top/bottom  "),
        Span::styled("t", Style::default().fg(Color::Cyan)),
        Span::raw(format!(" {}  ", tool_label)),
        Span::styled("r", Style::default().fg(Color::Cyan)),
        Span::raw(" refresh  "),
        Span::styled("q/Esc", Style::default().fg(Color::Cyan)),
        Span::raw(" back"),
    ];
    let footer = Paragraph::new(Line::from(spans));
    frame.render_widget(footer, area);
}

/// Extract HH:MM:SS from an ISO timestamp, or return a short fallback.
fn format_short_time(ts: &str) -> String {
    // Try to parse ISO format and extract time
    if ts.len() >= 19 {
        // "2026-04-01T12:34:56..." -> "12:34:56"
        if let Some(t_pos) = ts.find('T') {
            let time_part = &ts[t_pos + 1..];
            if time_part.len() >= 8 {
                return time_part[..8].to_string();
            }
        }
    }
    if ts.is_empty() {
        "        ".to_string()
    } else {
        // Truncate or pad to 8 chars
        format!("{:8}", &ts[..ts.len().min(8)])
    }
}

/// Truncate a single line to fit the available width.
fn truncate_line(line: &str, max: usize) -> String {
    let char_count = line.chars().count();
    if char_count <= max {
        line.to_string()
    } else if max > 3 {
        let truncated: String = line.chars().take(max - 3).collect();
        format!("{}...", truncated)
    } else {
        line.chars().take(max).collect()
    }
}

/// Apply basic formatting to content text based on message kind.
fn format_content_span(text: &str, color: Color, kind: &MessageKind) -> Span<'static> {
    let mut style = Style::default().fg(color);

    match kind {
        MessageKind::AssistantText => {
            // Check for bold markers
            if text.starts_with("**") || text.starts_with("# ") {
                style = style.add_modifier(Modifier::BOLD);
            }
            // Check for code
            if text.starts_with("```") || text.starts_with("    ") {
                style = style.add_modifier(Modifier::DIM);
            }
        }
        MessageKind::Thinking => {
            style = style.add_modifier(Modifier::DIM);
        }
        MessageKind::ToolResult => {
            style = style.add_modifier(Modifier::DIM);
        }
        _ => {}
    }

    Span::styled(text.to_string(), style)
}
