use std::io;

use crossterm::event::{self, Event, KeyCode, KeyModifiers};
use ratatui::{
    Frame,
    layout::{Constraint, Layout},
    style::{Color, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
};

use crate::tmux;

enum Field {
    Name,
    Cwd,
}

pub struct NewSessionForm {
    name: String,
    cwd: String,
    cursor_pos: usize,
    active: Field,
    pub result: Option<String>,
}

impl NewSessionForm {
    pub fn new() -> Self {
        let (name, cwd) = tmux::default_new_session_info();
        let cursor_pos = name.len();
        NewSessionForm {
            name,
            cwd,
            cursor_pos,
            active: Field::Name,
            result: None,
        }
    }

    fn active_text(&self) -> &str {
        match self.active {
            Field::Name => &self.name,
            Field::Cwd => &self.cwd,
        }
    }

    fn active_text_mut(&mut self) -> &mut String {
        match self.active {
            Field::Name => &mut self.name,
            Field::Cwd => &mut self.cwd,
        }
    }

    pub fn handle_key(&mut self, event: event::KeyEvent) {
        match event.code {
            KeyCode::Esc => {
                self.result = Some(String::new());
            }
            KeyCode::Enter => {
                if matches!(self.active, Field::Name) {
                    if self.name.trim().is_empty() {
                        return;
                    }
                    self.active = Field::Cwd;
                    self.cursor_pos = self.cwd.len();
                    return;
                }
                if self.name.trim().is_empty() {
                    return;
                }
                let cwd = if self.cwd.trim().is_empty() {
                    ".".to_string()
                } else {
                    let c = self.cwd.trim().to_string();
                    if let Some(rest) = c.strip_prefix('~') {
                        if let Some(home) = dirs::home_dir() {
                            format!("{}{rest}", home.display())
                        } else {
                            c
                        }
                    } else {
                        c
                    }
                };
                match tmux::create_session(self.name.trim(), &cwd) {
                    Ok(name) => self.result = Some(name),
                    Err(_) => self.result = Some(String::new()),
                }
            }
            KeyCode::Tab | KeyCode::Down => {
                match self.active {
                    Field::Name => {
                        self.active = Field::Cwd;
                        self.cursor_pos = self.cwd.len();
                    }
                    Field::Cwd => {
                        self.active = Field::Name;
                        self.cursor_pos = self.name.len();
                    }
                }
            }
            KeyCode::BackTab | KeyCode::Up => {
                match self.active {
                    Field::Name => {
                        self.active = Field::Cwd;
                        self.cursor_pos = self.cwd.len();
                    }
                    Field::Cwd => {
                        self.active = Field::Name;
                        self.cursor_pos = self.name.len();
                    }
                }
            }
            KeyCode::Backspace => {
                if self.cursor_pos > 0 {
                    // Convert char position to byte position for removal
                    let byte_pos = self.active_text().char_indices()
                        .nth(self.cursor_pos - 1)
                        .map(|(i, _)| i)
                        .unwrap_or(0);
                    let next_byte = self.active_text().char_indices()
                        .nth(self.cursor_pos)
                        .map(|(i, _)| i)
                        .unwrap_or(self.active_text().len());
                    self.active_text_mut().replace_range(byte_pos..next_byte, "");
                    self.cursor_pos -= 1;
                }
            }
            KeyCode::Delete => {
                let char_count = self.active_text().chars().count();
                if self.cursor_pos < char_count {
                    let byte_pos = self.active_text().char_indices()
                        .nth(self.cursor_pos)
                        .map(|(i, _)| i)
                        .unwrap_or(self.active_text().len());
                    let next_byte = self.active_text().char_indices()
                        .nth(self.cursor_pos + 1)
                        .map(|(i, _)| i)
                        .unwrap_or(self.active_text().len());
                    self.active_text_mut().replace_range(byte_pos..next_byte, "");
                }
            }
            KeyCode::Left => {
                if self.cursor_pos > 0 {
                    self.cursor_pos -= 1;
                }
            }
            KeyCode::Right => {
                let char_count = self.active_text().chars().count();
                if self.cursor_pos < char_count {
                    self.cursor_pos += 1;
                }
            }
            KeyCode::Home => {
                self.cursor_pos = 0;
            }
            KeyCode::End => {
                self.cursor_pos = self.active_text().chars().count();
            }
            KeyCode::Char('a') if event.modifiers.contains(KeyModifiers::CONTROL) => {
                self.cursor_pos = 0;
            }
            KeyCode::Char('e') if event.modifiers.contains(KeyModifiers::CONTROL) => {
                self.cursor_pos = self.active_text().chars().count();
            }
            KeyCode::Char('u') if event.modifiers.contains(KeyModifiers::CONTROL) => {
                self.active_text_mut().clear();
                self.cursor_pos = 0;
            }
            KeyCode::Char(c) => {
                let byte_pos = self.active_text().char_indices()
                    .nth(self.cursor_pos)
                    .map(|(i, _)| i)
                    .unwrap_or(self.active_text().len());
                self.active_text_mut().insert(byte_pos, c);
                self.cursor_pos += 1;
            }
            _ => {}
        }
    }

    pub fn render(&self, frame: &mut Frame) {
        let area = frame.area();

        // Name input block (3 rows: border + content + border)
        let name_active = matches!(self.active, Field::Name);
        let name_border = if name_active {
            Style::default().fg(Color::Cyan)
        } else {
            Style::default().fg(Color::DarkGray)
        };
        let name_block = Block::default()
            .borders(Borders::ALL)
            .title(" Name ")
            .border_style(name_border);

        // Dir input block
        let cwd_active = matches!(self.active, Field::Cwd);
        let cwd_border = if cwd_active {
            Style::default().fg(Color::Cyan)
        } else {
            Style::default().fg(Color::DarkGray)
        };
        let cwd_block = Block::default()
            .borders(Borders::ALL)
            .title(" Directory ")
            .border_style(cwd_border);

        let rows = Layout::vertical([
            Constraint::Length(3), // Name box
            Constraint::Length(3), // Dir box
            Constraint::Length(1), // Hints
            Constraint::Min(0),
        ])
        .split(area);

        let name_inner = name_block.inner(rows[0]);
        frame.render_widget(name_block, rows[0]);
        frame.render_widget(
            Paragraph::new(self.name.as_str()).style(Style::default().fg(Color::White)),
            name_inner,
        );

        let cwd_inner = cwd_block.inner(rows[1]);
        frame.render_widget(cwd_block, rows[1]);
        frame.render_widget(
            Paragraph::new(self.cwd.as_str()).style(Style::default().fg(Color::White)),
            cwd_inner,
        );

        // Hints
        let hint = match self.active {
            Field::Name => Line::from(vec![
                Span::styled(" Enter", Style::default().fg(Color::Cyan)),
                Span::raw(" next  "),
                Span::styled("Tab", Style::default().fg(Color::Cyan)),
                Span::raw(" switch  "),
                Span::styled("Esc", Style::default().fg(Color::Cyan)),
                Span::raw(" cancel"),
            ]),
            Field::Cwd => Line::from(vec![
                Span::styled(" Enter", Style::default().fg(Color::Cyan)),
                Span::raw(" create  "),
                Span::styled("Tab", Style::default().fg(Color::Cyan)),
                Span::raw(" switch  "),
                Span::styled("Esc", Style::default().fg(Color::Cyan)),
                Span::raw(" cancel"),
            ]),
        };
        frame.render_widget(Paragraph::new(hint), rows[2]);

        // Cursor
        let (cx, cy) = match self.active {
            Field::Name => (name_inner.x + self.cursor_pos as u16, name_inner.y),
            Field::Cwd => (cwd_inner.x + self.cursor_pos as u16, cwd_inner.y),
        };
        frame.set_cursor_position((cx, cy));
    }
}

/// Run the new-session form as a standalone TUI — identical setup to the main dashboard.
pub fn run_new_session_form() -> io::Result<Option<String>> {
    crossterm::terminal::enable_raw_mode()?;
    let mut stdout = io::stdout();
    crossterm::execute!(stdout, crossterm::terminal::EnterAlternateScreen)?;
    let backend = ratatui::prelude::CrosstermBackend::new(stdout);
    let mut terminal = ratatui::Terminal::new(backend)?;

    let mut form = NewSessionForm::new();

    loop {
        terminal.draw(|f| form.render(f))?;

        if let Some(ref result) = form.result {
            let name = if result.is_empty() {
                None
            } else {
                Some(result.clone())
            };

            crossterm::terminal::disable_raw_mode()?;
            crossterm::execute!(
                terminal.backend_mut(),
                crossterm::terminal::LeaveAlternateScreen
            )?;
            terminal.show_cursor()?;

            return Ok(name);
        }

        if event::poll(std::time::Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                form.handle_key(key);
            }
        }
    }
}
