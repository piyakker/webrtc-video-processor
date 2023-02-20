import os
import os.path as osp
import asyncio
import argparse

from aiortc import RTCSessionDescription
from aiortc.contrib.media import MediaPlayer

from utils.janus import JanusSession


async def publish(session, plugin, player):
    pc = session.createPTCPeerConnection('publisher')
    pc.addTrack(player.video)

    await pc.setLocalDescription(await pc.createOffer())
    request = {
        "request": "configure",
        "audio": False,
        "video": True
    }

    response = await plugin.send(
        {
            'body': request,
            "jsep": {
                "sdp": pc.localDescription.sdp,
                "type": pc.localDescription.type,
                "trickle": False
            }
        }
    )

    await pc.setRemoteDescription(
        RTCSessionDescription(
            sdp=response['jsep']['sdp'], type=response['jsep']['type']
        )
    )

async def main(session, player, room, name):
    await session.create()

    plugin = session.attach('janus.plugin.videoroom')

    response = await plugin.send(
        {
          'body': {
            'display': name,
            'ptype': 'publisher',
            'request': 'join',
            'room': room
          }
        }
    )

    publishers = response['plugindata']['data']['publishers']
    print('publishers in the room : ')
    for pub in publishers:
        print("- id : %(id)s, display : %(display)s" % pub)

    await publish(session, plugin, player)

    while True:
        await asyncio.sleep(3)



if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="janus publisher")
    parser.add_argument(
        "--url", help="url of janus http server, e.g. http://localhost:8088/janus")
    parser.add_argument("--dev", help="device file for the webcam")
    parser.add_argument("--name", type=str, default='raw',
                        help="name of publisher")
    parser.add_argument("--room", type=int, default=1234,
                        help="ID of video room to join")
    args = vars(parser.parse_args())

    session = JanusSession(args['url'])
    player = MediaPlayer(args['dev'], format='v4l2',
                         options={'fflags': 'nobuffer'})
    loop = asyncio.get_event_loop()
    try:
        loop.run_until_complete(
            main(
                session=session,
                player=player,
                room=args['room'],
                name=args['name'],
            )
        )
    except KeyboardInterrupt:
        pass
    finally:

        loop.run_until_complete(session.destroy())
