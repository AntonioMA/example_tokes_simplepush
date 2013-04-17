/* -*- Mode: js2; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- /
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

var MessageManager = {
  
  debug: true,
  
  init: function mm_init() {
    this.debug && console.log("On MessageManager.init");
    this.initialized = true;
    // Init Push DB Manager
    PushDBManager.init();
    // Init UI Managers
    LoginManager.init();
    ThreadUI.init();
    ThreadListUI.init();
    
    // Get the previous registrations, or register the push system if needed.
    // Note that for this demo we keep the same channel for all possible users, but for this to work
    // correctly what we should do instead is:
    //    1. Remember to unregister after we disconnect (be tidy!)
    //    2. Use a new channel for each connection
    //  or
    //    1. Store the registrations associated with the user that it belongs to, so we can keep getting
    //       messages even when the application is closed. But to do that we should do this *after* we have
    //       logged in, and since we pass the push endPoint with the login it would be kinda hard to do...

    // We're going for the first solution here. The second one would looks something like...
    /* 
     var registrations = PushManager.getRegistrations();
     if (!registrations) {
     registrations =       [{
     'name': 'demo-messages',
     'callback': WebJabber.init,
     'handler': MessageManager.onmessageReceived
     }];
     // If we're here then we need to register
     PushManager.register(registrations);
    }
     */ 
     var registrations =  [{
         'name': 'demo-messages',
         'callback': WebJabber.init,
         'handler': MessageManager.onmessageReceived
     }];
     // If we're here then we need to register
     PushManager.register(registrations);
    
    
    // Add listeners
    window.addEventListener('hashchange', this.onHashChange.bind(this));
    document.addEventListener('mozvisibilitychange',
                              this.onVisibilityChange.bind(this));
    // Retrieve height for future transitions
    this.initialHeight = ThreadListUI.view.offsetHeight;
  },
  
  slide: function mm_slide(callback) {
    var mainWrapper = document.getElementById('main-wrapper');
    if (!mainWrapper.classList.contains('to-left')) {
      mainWrapper.classList.remove('to-right');
      mainWrapper.classList.add('to-left-boot');
      mainWrapper.classList.add('to-left');
      mainWrapper.addEventListener('transitionend', function slideTransition() {
          mainWrapper.removeEventListener('transitionend', slideTransition);
          if (callback) {
            callback();
          }
        });
    } else {
      mainWrapper.classList.remove('to-left');
      mainWrapper.classList.add('to-right');
      mainWrapper.addEventListener('animationend', function slideAnimation() {
          mainWrapper.removeEventListener('animationend', slideAnimation);
          if (callback) {
            callback();
          }
        });
            
    }
  },

  onHashChange: function mm_onHashChange(e) {
    var mainWrapper = document.getElementById('main-wrapper');
    var threadMessages = document.getElementById('thread-messages');
    switch (window.location.hash) {
    case '#logout':
      // TODO Logout to the Jabber server
      PushManager.unregister();
      window.close();
      break;
    case '#thread-list':
      //Keep the  visible button the :last-child
      MessageManager.currentNum = null;
      MessageManager.slide(function() {
          ThreadUI.view.innerHTML = '';
          if (MessageManager.activityTarget) {
            window.location.hash =
              '#num=' + MessageManager.activityTarget;
            delete MessageManager.activityTarget;
            delete MessageManager.lockActivity;
          }
        });
            
      break;
    default:
      var num = this.getNumFromHash();
      if (num) {
        var messageInput = document.getElementById('message-to-send');
        MessageManager.currentNum = num;
                
        this.getMessages(ThreadUI.renderMessages,
                         num, false, function() {
                           MessageManager.slide(function() {
                               messageInput.focus();
                             });
                         });
      }
      break;
    }
  },

  onVisibilityChange: function mm_onVisibilityChange(e) {
    if (!document.mozHidden) {
      if (window.location.hash == '#edit') {
        return;
      }
      this.getThreads(ThreadListUI.renderThreads);
      if (!MessageManager.lockActivity) {
        var num = this.currentNum;
        if (num) {
          var typedText = ThreadUI.input.value;
          this.getMessages(ThreadUI.renderMessages, num, false,
                           function() {
                             // Restored previous typed text.
                             ThreadUI.input.value = typedText;
                             ThreadUI.input.focus();
                             ThreadUI.enableSend();
                           });
        }
      }
    }
  },
    
  getNumFromHash: function mm_getNumFromHash() {
    var num = /\bnum=(.+)(&|$)/.exec(window.location.hash);
    return num ? num[1] : null;
  },

  getThreads: function mm_getThreads(callback, extraArg) {
    WebJabber.getContacts(function(json){
        callback(json.contacts,extraArg) ;
      });
  },

  // Retrieve messages from DB and execute callback
  getMessages: function mm_getMessages(callback, email, invert, callbackArgs) {
    var messages = [];
    PushDBManager.getPushMessages(email, function(messagesReceived) {
        // Concat the received messages
        messages = messages.concat(messagesReceived);
        PushDBManager.getPushMessages(MessageManager.currentUser, function(messagesSent) {
            var messagesToConcat = [];
            for (var i = 0; i < messagesSent.length; i++) {
              if (messagesSent[i].to === email) {
                messagesToConcat.push(messagesSent[i]);
              }
            };
            messages = messages.concat(messagesToConcat);
            messages.sort(function(a,b){
                return b.timestamp - a.timestamp;
              });
            callback(messages, callbackArgs);
          });
      });
  },

  send: function mm_send(message, callback, errorHandler) {
    // Store in DB
    PushDBManager.storePushMessage(message, function(result){
        WebJabber.send(message.to, message.body, callback)
    });
  },

  login: function mm_login(user,pass,callback){
    // TODO: Things fail sometimes, surprisingly... this should pass an errorHandler
    WebJabber.connect(user,pass,callback);
  },
  onmessageReceived: function mm_onmessageReceived(message) {
    // In this case we have new messages!
    WebJabber.getMessages(function(json){
        var messages = json.messages;
        var messagesFormatted = [];
        for (var i = 0; i < messages.length; i++) {
          var tmpTime = new Date(messages[i].timestamp.date+'T'+messages[i].timestamp.time);
          var message = {
            from: messages[i].from,
            body: messages[i].body,
            to: WebJabber.jid,
            timestamp: tmpTime
          };
          messagesFormatted.push(message);
        }
        // First of we store it in our DB
        var storeInDB = function(messagesToStore, callback) {
          var message = messagesToStore.pop();
          PushDBManager.storePushMessage(message, function(){
              if (messagesToStore.length === 0){
                if (callback){
                  callback();
                }
                return;
              }
              storeInDB(messagesToStore, callback);
            });
        };

        storeInDB(messagesFormatted, function(){
            if (window.location.hash != '#thread-list') {
              // If currently we are in a thread we re-render it!
              MessageManager.getMessages(ThreadUI.renderMessages, MessageManager.currentNum, false);
            }
          });
      });
        
  }
};

var ThreadListUI = {
  get view() {
    delete this.view;
    return this.view = document.getElementById('thread-list-container');
  },
  get pageHeader() {
    delete this.pageHeader;
    return this.pageHeader = document.getElementById('list-edit-title');
  },
  get editForm() {
    delete this.editForm;
    return this.editForm = document.getElementById('threads-edit-form');
  },

  init: function thlui_init() {
    this.view.addEventListener('click', this);
    this.editForm.addEventListener('submit', this);
  },

  handleEvent: function thlui_handleEvent(evt) {
    switch (evt.type) {
    case 'submit':
    evt.preventDefault();
    return false;
    break;
    }
  },

  renderThreads: function thlui_renderThreads(threads, callback) {
    ThreadListUI.view.innerHTML = '';
    if (threads.length > 0) {
      var dayHeaderIndex;
      var appendThreads = function(threads, callback) {
        if (threads.length === 0) {
          if (callback) {
            callback();
          }
          return;
        }
        var thread = threads.pop();
        setTimeout(function() {
            ThreadListUI.appendThread(thread);
            appendThreads(threads, callback);
          });
      }
      ThreadListUI.createNewHeader();
      appendThreads(threads);

    } else {
      document.getElementById('threads-fixed-container').classList.add('hide');
      var noResultHTML = '<div id="no-result-container">' +
      ' <div id="no-result-message">' +
      '   <p>' + _('noMessages-title') + '</p>' +
      '   <p>' + _('noMessages-text') + '</p>' +
      ' </div>' +
      '</div>';
      ThreadListUI.view.innerHTML = noResultHTML;
    }

    // Callback when every thread is appended
    if (callback) {
      callback();
    }
  },

  appendThread: function thlui_appendThread(thread) {
    // Retrieve ThreadsContainer
    var threadsContainerID = 'threadsContainer_today';
    var threadsContainer = document.getElementById(threadsContainerID);

    // Create DOM element
    var roster = thread.roster;
    var status = thread.presence;
    var flag = (status == 'online') ? 'unread' : '';
    var threadDOM = document.createElement('li');
    threadDOM.id = 'thread_' + roster;

    // Retrieving params from thread
    var bodyText = (thread.body || '').split('\n')[0];
    // Create HTML Structure
    var structureHTML = '<label class="danger">' +
    '<input type="checkbox" value="' + roster + '">' +
    '<span></span>' +
    '</label>' +
    '<a href="#num=' + roster +
    '" class="' +
    flag + '">' +
    '<aside class="icon icon-unread">unread</aside>' +
    '<aside class="pack-end">' +
    '<img src="">' +
    '</aside>' +
    '<p class="name">' + roster + '</p>' +
    '<p><time>' + status +
    '</time>' + '' + '</p>' +
    '</a>';

    // Update HTML
    threadDOM.innerHTML = structureHTML;

    // Append Element
    threadsContainer.appendChild(threadDOM);
  },

  // Adds a new grouping header if necessary (today, tomorrow, ...)
  createNewHeader: function thlui_createNewHeader(timestamp) {
    // Create UL DOM Element
    var threadsContainerDOM = document.createElement('ul');
    threadsContainerDOM.id = 'threadsContainer_today';
    // Add to DOM all elements
    ThreadListUI.view.appendChild(threadsContainerDOM);
  }
    
};

var LoginManager = {
  get view() {
    delete this.view;
    return this.view = document.getElementById('login');
  },
  get loginButton() {
    delete this.loginButton;
    return this.loginButton = document.getElementById('login-button');
  },
  get userInput() {
    delete this.userInput;
    return this.userInput = document.getElementById('user-email');
  },
  get passwordInput() {
    delete this.passwordInput;
    return this.passwordInput = document.getElementById('user-password');
  },
  init: function lm_init() {
    this.loginButton.addEventListener('click',this.login.bind(this));
  },
  login: function lm_login(){
    WaitingScreen.show();
    MessageManager.login(this.userInput.value, this.passwordInput.value, function(){
        LoginManager.view.addEventListener('transitionend',function(){
            MessageManager.currentUser = WebJabber.jid;
            MessageManager.getThreads(ThreadListUI.renderThreads);
            LoginManager.view.classList.add('hidden');
            WaitingScreen.hide();
          });
        LoginManager.view.classList.add('hiding');
      });
        
  }

};


var ThreadUI = {
  get view() {
    delete this.view;
    return this.view = document.getElementById('messages-container');
  },

  get contactInput() {
    delete this.contactInput;
    return this.contactInput = document.getElementById('receiver-input');
  },

  get backButton() {
    delete this.backButton;
    return this.backButton = document.getElementById('go-to-threadlist');
  },

  get clearButton() {
    delete this.clearButton;
    return this.clearButton = document.getElementById('clear-search');
  },

  get title() {
    delete this.title;
    return this.title = document.getElementById('header-text');
  },

  get input() {
    delete this.input;
    return this.input = document.getElementById('message-to-send');
  },

  get sendButton() {
    delete this.sendButton;
    return this.sendButton = document.getElementById('send-message');
  },

  get pickButton() {
    delete this.pickButton;
    return this.pickButton = document.getElementById('icon-contact');
  },
    
  get pageHeader() {
    delete this.pageHeader;
    return this.pageHeader = document.getElementById('messages-edit-title');
  },

  get telForm() {
    delete this.telForm;
    return this.telForm = document.getElementById('messages-tel-form');
  },

  get sendForm() {
    delete this.sendForm;
    return this.sendForm = document.getElementById('new-sms-form');
  },

  init: function thui_init() {
    this.sendButton.addEventListener('click', this.sendMessage.bind(this));

    // Prevent sendbutton to hide the keyboard:
    this.sendButton.addEventListener('mousedown',
                                     function btnDown(event) {
                                       event.preventDefault();
                                       event.target.classList.add('active');
                                     }
                                     );
    this.sendButton.addEventListener('mouseup',
                                     function btnUp(event) {
                                       event.target.classList.remove('active');
                                     }
                                     );
    this.sendButton.addEventListener('mouseout',
                                     function mouseOut(event) {
                                       event.target.classList.remove('active');
                                     }
                                     );
    this.backButton.addEventListener('click',
                                     this.onBackAction.bind(this));
    this.input.addEventListener('input', this.updateInputHeight.bind(this));
    this.input.addEventListener('input', this.enableSend.bind(this));
    this.contactInput.addEventListener('input', this.enableSend.bind(this));
    this.title.addEventListener('click', this.activateContact.bind(this));
    this.clearButton.addEventListener('click', this.clearContact.bind(this));
    this.view.addEventListener('click', this);
    this.telForm.addEventListener('submit', this);
    this.sendForm.addEventListener('submit', this);
  },

  onBackAction: function thui_onBackAction() {
    // Hide Keyboard if present
    var backHandler = function() {
      if (ThreadUI.input.value.length == 0) {
        window.location.hash = '#thread-list';
        return;
      }
      var response = window.confirm(_('discard-sms'));
      if (response) {
        ThreadUI.cleanFields(true);
        window.location.hash = '#thread-list';
      }
    }
    if(MessageManager.initialHeight != ThreadUI.view.offsetHeight) {
      window.addEventListener('resize', function keyboardHidden() {
          if(MessageManager.initialHeight == ThreadUI.view.offsetHeight) {
            window.removeEventListener('resize',keyboardHidden);
            window.mozRequestAnimationFrame(function(){
                backHandler();
              });
          }
        });
      this.input.blur();
      this.contactInput.blur();
    } else {
      backHandler();
    }
  },

  enableSend: function thui_enableSend() {
    if (window.location.hash == '#new' && this.contactInput.value.length == 0) {
      this.sendButton.disabled = true;
      return;
    }

    this.sendButton.disabled = !(this.input.value.length > 0);
  },

  scrollViewToBottom: function thui_scrollViewToBottom(animateFromPos) {
    if (!animateFromPos) {
      this.view.scrollTop = this.view.scrollHeight;
      return;
    }

    clearInterval(this.viewScrollingTimer);
    this.view.scrollTop = animateFromPos;
    this.viewScrollingTimer = setInterval((function scrollStep() {
          var view = this.view;
          var height = view.scrollHeight - view.offsetHeight;
          if (view.scrollTop === height) {
            clearInterval(this.viewScrollingTimer);
            return;
          }
          view.scrollTop += Math.ceil((height - view.scrollTop) / 2);
        }).bind(this), 100);
  },
    
  updateInputHeight: function thui_updateInputHeight() {
    var input = this.input;
    var inputCss = window.getComputedStyle(input, null);
    var inputMaxHeight = parseInt(inputCss.getPropertyValue('max-height'), 10);
    //Constant difference of height beteween button and growing input
    var deviationHeight = 30;
    if (input.scrollHeight > inputMaxHeight) {
      return;
    }

    input.style.height = null;
    // If the scroll height is smaller than original offset height, we keep
    // offset height to keep original height, otherwise we use scroll height
    // with additional margin for preventing scroll bar.
    input.style.height = input.offsetHeight > input.scrollHeight ?
    input.offsetHeight / Utils.getFontSize() + 'rem' :
    input.scrollHeight / Utils.getFontSize() + 'rem';

    var newHeight = input.getBoundingClientRect().height;

    // Add 0.7 rem that are equal to the message box vertical padding
    var bottomToolbarHeight = (newHeight / Utils.getFontSize() + 0.7) + 'rem';
    var sendButtonTranslate = (input.offsetHeight - deviationHeight) /
    Utils.getFontSize() + 'rem';
    var bottomToolbar =
    document.querySelector('#new-sms-form');

    bottomToolbar.style.height = bottomToolbarHeight;
    ThreadUI.sendButton.style.marginTop = sendButtonTranslate;
    this.view.style.bottom = bottomToolbarHeight;
    this.scrollViewToBottom();
  },
  // Adds a new grouping header if necessary (today, tomorrow, ...)
  createTimeHeader: function thui_createTimeHeader(timestamp, hourOnly) {
    // Create DOM Element for header
    var headerDOM = document.createElement('header');
    // Append 'time-update' state
    headerDOM.dataset.timeUpdate = true;
    headerDOM.dataset.time = timestamp;
    // Add text
    var content;
    if (!hourOnly) {
      content = Utils.getHeaderDate(timestamp) + ' ' +
        Utils.getFormattedHour(timestamp);
    } else {
      content = Utils.getFormattedHour(timestamp);
      headerDOM.dataset.hourOnly = 'true';
    }
    headerDOM.innerHTML = content;
    // Append to DOM
    ThreadUI.view.appendChild(headerDOM);

    // Create list element for ul
    var messagesContainerDOM = document.createElement('ul');

    // Append to DOM
    ThreadUI.view.appendChild(messagesContainerDOM);

  },
  // Method for updating the header with the info retrieved from Contacts API
  updateHeaderData: function thui_updateHeaderData() {
    var number = MessageManager.currentNum;
    // Add data to contact activity interaction
    this.title.dataset.phoneNumber = number;
    this.title.innerHTML = number;
  },

  renderMessages: function thui_renderMessages(messages, callback) {
    // Clean fields
    ThreadUI.cleanFields();
        
    // Update Header
    ThreadUI.updateHeaderData();
    // Clean list of messages
    ThreadUI.view.innerHTML = '';
    // Update header index
    ThreadUI.dayHeaderIndex = 0;
    ThreadUI.timeHeaderIndex = 0;
        
    // We append messages in a non-blocking way
    var appendMessages = function(messages, callback) {
      if (messages.length == 0) {
        if (callback) {
          callback();
        }
        return;
      }
      var message = messages.pop();
      setTimeout(function() {
          ThreadUI.appendMessage(message);
          appendMessages(messages, callback);
        });
    };
    appendMessages(messages, function am_callback() {
        // Boot update of headers
        Utils.updateTimeHeaderScheduler();
        // Callback when every message is appended
        if (callback) {
          callback();
        }
      });
  },

  appendMessage: function thui_appendMessage(message) {
    var id = message.timestamp;
    var bodyText = message.body;
    var bodyHTML = Utils.escapeHTML(bodyText);

    if(message.from !== WebJabber.jid) {
      var messageClass = 'received';
    } else {
      var messageClass = 'sent';
    }
        

    var messageDOM = document.createElement('li');
    messageDOM.classList.add('bubble');
    messageDOM.id = 'message-' + id;

    var inputValue = id;

    // Create HTML content
    var messageHTML = '<label class="danger">' +
    '<input type="checkbox" value="' + inputValue + '">' +
    '<span></span>' +
    '</label>' +
    '<a class="' + messageClass + '">';
    messageHTML += '<p>' + bodyHTML + '</p></a>';

    // Add structure to DOM element
    messageDOM.innerHTML = messageHTML;

    //Check if we need a new header
    var timestamp = message.timestamp.getTime();
    var tmpDayIndex = Utils.getDayDate(timestamp);
    var tmpHourIndex = timestamp;

    if (tmpDayIndex > ThreadUI.dayHeaderIndex) { // Different day
      ThreadUI.createTimeHeader(timestamp, true);
      ThreadUI.dayHeaderIndex = tmpDayIndex;
      ThreadUI.timeHeaderIndex = tmpHourIndex;
    } else { // Same day
      if (tmpHourIndex > ThreadUI.timeHeaderIndex + 10 * 60 * 1000) { // 10min
        ThreadUI.createTimeHeader(timestamp, true);
        ThreadUI.timeHeaderIndex = tmpHourIndex;
      }
    }
    // Append element
    ThreadUI.view.lastChild.appendChild(messageDOM);
    // Scroll to bottom
    ThreadUI.scrollViewToBottom();
  },

  clearContact: function thui_clearContact() {
    this.contactInput.value = '';
    this.view.innerHTML = '';
  },

  handleEvent: function thui_handleEvent(evt) {
    switch (evt.type) {
    case 'submit':
    evt.preventDefault();
    return false;
    break;
    }
  },

  cleanFields: function thui_cleanFields(forceClean) {
    var self = this;
    var clean = function clean() {
      self.input.value = '';
      self.sendButton.disabled = true;
      self.contactInput.value = '';
      self.updateInputHeight();
    };
    if (window.location.hash == this.previousHash ||
        this.previousHash == '#new') {
      if (forceClean) {
        clean();
      }
    } else {
      clean();
    }
    this.enableSend();
    this.previousHash = window.location.hash;
  },

  sendMessage: function thui_sendMessage(resendText) {
    var num, text;

    if (resendText && (typeof(resendText) === 'string') && resendText !== '') {
      num = MessageManager.currentNum;
      text = resendText;
    } else {
      // Retrieve num depending on hash
      var hash = window.location.hash;
      // Depending where we are, we get different num
      if (hash == '#new') {
        num = this.contactInput.value;
        if (!num) {
          return;
        }
      } else {
        num = MessageManager.currentNum;
      }

      // Retrieve text
      text = this.input.value;
      if (!text) {
        return;
      }
    }
    // Clean fields (this lock any repeated click in 'send' button)
    this.cleanFields(true);
    // Remove when
    // https://bugzilla.mozilla.org/show_bug.cgi?id=825604 landed
    MessageManager.currentNum = num;
    this.updateHeaderData();
    // Send the SMS


    var message = {
      body: text,
      from: MessageManager.currentUser,
      to: num,
      timestamp: (new Date())
    }

        

    if (window.location.hash == '#new') {
      // If we are in 'new' we go to the right thread
      // 'num' has been internationalized by Gecko
      window.location.hash = '#num=' + num;
    } else {
      ThreadUI.appendMessage(message);
    }
    MessageManager.send(message);
    MessageManager.getThreads(ThreadListUI.renderThreads);
  },

  activateContact: function thui_activateContact() {
    var options = {};
    // Call to 'new' or 'view' depending on existence of contact
    if (this.title.dataset.isContact == 'true') {
      //TODO modify this when 'view' activity is available on contacts
      // options = {
      //   name: 'view',
      //   data: {
      //     type: 'webcontacts/contact'
      //   }
      // };
    } else {
      options = {
        name: 'new',
        data: {
          type: 'webcontacts/contact',
          params: {
            'email': this.title.dataset.phoneNumber
          }
        }
      };
    }

    try {
      var activity = new MozActivity(options);
      activity.onsuccess = ThreadUI.onCreateContact;
    } catch (e) {
      this.debug && console.log('WebActivities unavailable? : ' + e);
    }
  },

  onCreateContact: function thui_onCreateContact() {
    ThreadListUI.getThreads(ThreadUI.renderThreads);
    // Update Header if needed
    if (window.location.hash.substr(0, 5) === '#num=') {
      ThreadUI.updateHeaderData();
    }
  }
};

var WaitingScreen = {
  get loading() {
    delete this.loading;
    return this.loading = document.getElementById('loading');
  },
  get loadingHeader() {
    delete this.loadingHeader;
    return this.loadingHeader = document.getElementById('loading-header');
  },
  show: function ws_show() {
    this.loading.classList.add('show-loading');
  },
  hide: function ws_hide() {
    this.loading.classList.remove('show-loading');
  },
  update: function ws_update(text) {
    this.loadingHeader.innerHTML = text;
  }
};



window.addEventListener('resize', function resize() {
    // Scroll to bottom
    ThreadUI.scrollViewToBottom();
  });

window.addEventListener('load', function showBody() {
    if (!MessageManager.initialized) {
      MessageManager.init();
    }

    // Set the 'lang' and 'dir' attributes to <html> when the page is translated
    document.documentElement.lang = navigator.mozL10n.language.code;
    document.documentElement.dir = navigator.mozL10n.language.direction;
  });

function showThreadFromSystemMessage(number) {
  var showAction = function act_action(number) {
    var currentLocation = window.location.hash;
    switch (currentLocation) {
    case '#thread-list':
      window.location.hash = '#num=' + number;
      delete MessageManager.lockActivity;
      break;
    case '#new':
      window.location.hash = '#num=' + number;
      delete MessageManager.lockActivity;
      break;
    default:
      if (currentLocation.indexOf('#num=') != -1) {
        // Don't switch back to thread list if we're
        // already displaying the requested number.
        if (currentLocation == '#num=' + number) {
          delete MessageManager.lockActivity;
        } else {
          MessageManager.activityTarget = number;
          window.location.hash = '#thread-list';
        }
      } else {
        window.location.hash = '#num=' + number;
        delete MessageManager.lockActivity;
      }
      break;
    }
  };

  if (!document.documentElement.lang) {
    window.addEventListener('localized', function waitLocalized() {
        window.removeEventListener('localized', waitLocalized);
        showAction(number);
      });
  } else {
    if (!document.mozHidden) {
      // Case of calling from Notification
      showAction(number);
      return;
    }
    document.addEventListener('mozvisibilitychange',
                              function waitVisibility() {
                                document.removeEventListener('mozvisibilitychange', waitVisibility);
                                showAction(number);
                              });
  }
}


window.navigator.mozSetMessageHandler('push', function(e) {
  var pushEndPoint = e.pushEndpoint;
  // TODO: Remove this hack once it's correctly returned... but for now...
  pushEndPoint = pushEndPoint.replace('localhost','pushdev.srv.openwebdevice.com');
  debug && console.log("Got a message from " + pushEndPoint);
  var registrations = PushManager.getRegistrations();
  for (var i = 0; i < registrations.length; i++) {
    if (registrations[i].pushEndpoint == pushEndPoint) {
      registrations[i].handler();
      break;
    }
  };
});
