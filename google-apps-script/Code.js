/**
 * BeyondGlean — Google Workspace Bridge
 * 
 * Google Apps Script that acts as a web API for creating/reading Google Docs,
 * Calendar events, and Drive files. Deploy as web app, call from MCP server.
 */

// ============================================================
// GOOGLE DOCS
// ============================================================

/**
 * Create a new Google Doc with formatted content.
 * @param {Object} params - { title, content (HTML or plain), folderId? }
 * @returns {Object} - { docId, docUrl }
 */
function createDoc(params) {
  const doc = DocumentApp.create(params.title || 'Untitled');
  const body = doc.getBody();
  
  if (params.content) {
    // Parse simple markdown-like formatting
    const lines = params.content.split('\n');
    lines.forEach(function(line) {
      if (line.startsWith('# ')) {
        body.appendParagraph(line.substring(2))
          .setHeading(DocumentApp.ParagraphHeading.HEADING1);
      } else if (line.startsWith('## ')) {
        body.appendParagraph(line.substring(3))
          .setHeading(DocumentApp.ParagraphHeading.HEADING2);
      } else if (line.startsWith('### ')) {
        body.appendParagraph(line.substring(4))
          .setHeading(DocumentApp.ParagraphHeading.HEADING3);
      } else if (line.startsWith('- ')) {
        body.appendListItem(line.substring(2))
          .setGlyphType(DocumentApp.GlyphType.BULLET);
      } else if (line.startsWith('---')) {
        body.appendHorizontalRule();
      } else if (line.trim() === '') {
        body.appendParagraph('');
      } else {
        // Handle bold (**text**) and italic (*text*)
        var para = body.appendParagraph('');
        var remaining = line;
        while (remaining.length > 0) {
          var boldMatch = remaining.match(/\*\*(.+?)\*\*/);
          if (boldMatch && boldMatch.index === 0) {
            para.appendText(boldMatch[1]).setBold(true);
            remaining = remaining.substring(boldMatch[0].length);
          } else if (boldMatch) {
            para.appendText(remaining.substring(0, boldMatch.index));
            remaining = remaining.substring(boldMatch.index);
          } else {
            para.appendText(remaining);
            remaining = '';
          }
        }
      }
    });
  }
  
  // Insert image if URL provided
  if (params.imageUrl) {
    try {
      var response = UrlFetchApp.fetch(params.imageUrl);
      var blob = response.getBlob();
      body.appendImage(blob);
    } catch (e) {
      body.appendParagraph('[Image failed to load: ' + params.imageUrl + ']');
    }
  }
  
  // Move to folder if specified
  if (params.folderId) {
    try {
      var file = DriveApp.getFileById(doc.getId());
      var folder = DriveApp.getFolderById(params.folderId);
      folder.addFile(file);
      DriveApp.getRootFolder().removeFile(file);
    } catch (e) {
      // Folder move failed, doc stays in root
    }
  }
  
  doc.saveAndClose();
  
  return {
    docId: doc.getId(),
    docUrl: doc.getUrl(),
    title: doc.getName()
  };
}

// ============================================================
// GOOGLE CALENDAR
// ============================================================

/**
 * Get today's calendar events.
 * @returns {Array} - [{ title, start, end, location, description }]
 */
function getTodayEvents() {
  var now = new Date();
  var startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  
  var events = CalendarApp.getDefaultCalendar().getEvents(startOfDay, endOfDay);
  return events.map(function(e) {
    return {
      title: e.getTitle(),
      start: e.getStartTime().toISOString(),
      end: e.getEndTime().toISOString(),
      location: e.getLocation(),
      description: e.getDescription(),
      guests: e.getGuestList().map(function(g) { return g.getEmail(); })
    };
  });
}

/**
 * Create a calendar event.
 * @param {Object} params - { title, start (ISO), end (ISO), description?, guests? }
 */
function createCalendarEvent(params) {
  var startDate = new Date(params.start);
  var endDate = new Date(params.end);
  
  var options = {};
  if (params.description) options.description = params.description;
  if (params.guests) options.guests = params.guests.join(',');
  
  var event = CalendarApp.getDefaultCalendar().createEvent(
    params.title, startDate, endDate, options
  );
  
  return {
    eventId: event.getId(),
    title: event.getTitle(),
    start: event.getStartTime().toISOString(),
    end: event.getEndTime().toISOString()
  };
}

// ============================================================
// GOOGLE DRIVE
// ============================================================

/**
 * Search Google Drive for files.
 * @param {Object} params - { query, maxResults? }
 */
function searchDrive(params) {
  var files = DriveApp.searchFiles(params.query || '');
  var results = [];
  var max = params.maxResults || 10;
  var count = 0;
  
  while (files.hasNext() && count < max) {
    var file = files.next();
    results.push({
      id: file.getId(),
      name: file.getName(),
      url: file.getUrl(),
      mimeType: file.getMimeType(),
      lastUpdated: file.getLastUpdated().toISOString(),
      size: file.getSize()
    });
    count++;
  }
  
  return results;
}

// ============================================================
// WEB APP ENDPOINT
// ============================================================

/**
 * Handle GET requests (for testing).
 */
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    message: 'BeyondGlean Google Workspace Bridge is running',
    availableActions: ['createDoc', 'getTodayEvents', 'createCalendarEvent', 'searchDrive']
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handle POST requests (main API).
 * Body: { action: "createDoc"|"getTodayEvents"|"createCalendarEvent"|"searchDrive", params: {...} }
 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    var params = body.params || {};
    var result;
    
    switch (action) {
      case 'createDoc':
        result = createDoc(params);
        break;
      case 'getTodayEvents':
        result = getTodayEvents();
        break;
      case 'createCalendarEvent':
        result = createCalendarEvent(params);
        break;
      case 'searchDrive':
        result = searchDrive(params);
        break;
      default:
        return ContentService.createTextOutput(JSON.stringify({
          error: 'Unknown action: ' + action
        })).setMimeType(ContentService.MimeType.JSON);
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      status: 'ok',
      result: result
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      error: err.message,
      stack: err.stack
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
