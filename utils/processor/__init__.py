from .facedet import FaceDetStreamTrack


_processors = {
    'facedet': FaceDetStreamTrack,
}

def get_processer_names():
    return list(_processors.keys())

def get_processor_by_name(name):
    return _processors[name]
