// autoLogout.js
var AutoLogout = (function() {
    function AutoLogout() {
      this.events = ['load', 'mousemove', 'mousedown', 'click', 'scroll', 'keypress'];
  
      this.warn = this.warn.bind(this);
      this.logout = this.logout.bind(this);
      this.resetTimeout = this.resetTimeout.bind(this);
  
      var self = this;
      this.events.forEach(function(event) {
        window.addEventListener(event, self.resetTimeout);
      });
  
      this.setTimeout();
    }
  
    var _p = AutoLogout.prototype;
  
    _p.clearTimeout = function() {
      if (this.warnTimeout) clearTimeout(this.warnTimeout);
      if (this.logoutTimeout) clearTimeout(this.logoutTimeout);
    };
  
    _p.setTimeout = function() {
      this.warnTimeout = setTimeout(this.warn, 30 * 1000); // 29 minutes
      this.logoutTimeout = setTimeout(this.logout, 60 * 1000); // 30 minutes
    };
  
    _p.resetTimeout = function() {
      this.clearTimeout();
      this.setTimeout();
    };
  
    _p.warn = function() {
      alert('You will be logged out automatically in 1 minute.');
    };
  
    _p.logout = function() {
      // Send a logout request to the API
      fetch('/logout', { method: 'POST' }).then(response => {
        if (response.ok) {
          window.location.href = '/login'; // Redirect to login page
        } else {
          console.error('Logout failed');
        }
      });
  
      this.destroy(); // Cleanup
    };
  
    _p.destroy = function() {
      this.clearTimeout();
  
      var self = this;
      this.events.forEach(function(event) {
        window.removeEventListener(event, self.resetTimeout);
      });
    };
  
    return AutoLogout;
  })();
  
  // Initialize AutoLogout when the page is fully loaded
  window.addEventListener('load', function() {
    new AutoLogout();
  });
  