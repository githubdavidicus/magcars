from flask import Flask, render_template
from flask_socketio import SocketIO, emit
import time

app = Flask(__name__)
socketio = SocketIO(app)

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    print('Client connected!')

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected!')

@socketio.on('data_from_script')
def handle_data(data):
    # This is where your Python script would send data to the server
    # For this example, we'll just print it and send a response back
    print('Received data:', data)
    emit('response', {'status': 'Data received!'})

# This function simulates real-time data generation from your script
def send_real_time_data():
    while True:
        # Your data source here
        data = {'value': time.time()} 
        socketio.emit('real_time_update', data)
        time.sleep(1) # Send data every second

if __name__ == '__main__':
    # Start a background thread to send the data
    from threading import Thread
    thread = Thread(target=send_real_time_data)
    thread.daemon = True
    thread.start()

    # Run the Flask app
    socketio.run(app, debug=True)